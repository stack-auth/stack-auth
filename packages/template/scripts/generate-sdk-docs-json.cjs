const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const OUTPUT_DIR = path.join(ROOT_DIR, 'dist', 'sdk-docs');
const TSCONFIG_PATH = path.join(ROOT_DIR, 'tsconfig.json');

// ============================================================
// CONFIGURATION: Tag-based filtering
// ============================================================
// USE_TAG_FILTER: Master switch for tag-based filtering
// - false: Document ALL exported items regardless of JSDoc tags (default behavior)
// - true: Apply tag-based filtering according to TAG_FILTER_MODE
const USE_TAG_FILTER = false;

// TAG_FILTER_MODE: Filtering strategy when USE_TAG_FILTER is true
// This setting is IGNORED when USE_TAG_FILTER is false
//
// - 'opt-in' (Whitelist): Only document items explicitly marked with @stackdoc
//   Use this when you want strict control over what's documented
//   Example: export function myFunc() { } // Not documented
//            /** @stackdoc */ export function myFunc() { } // Documented
//
// - 'opt-out' (Blacklist): Document all items EXCEPT those marked with @internal
//   Use this when most things should be documented but you want to hide internals
//   Example: export function myFunc() { } // Documented
//            /** @internal */ export function myFunc() { } // Not documented
const TAG_FILTER_MODE = 'opt-in';

// MIXIN_TYPES: Types that are building blocks/mixins composed into other types
// These will be output to mixins.json instead of types.json
const MIXIN_TYPES = new Set([
  'Auth',
  'Customer', 
  'Connection',
  'AuthLike',
  'BaseUser',
  'UserExtra',
]);

// Auto-generate descriptions for AsyncStoreProperty-style methods
// These are mapped type methods that don't have JSDoc attached
function generateAsyncStorePropertyDescription(name) {
  // Helper to format resource name (e.g., "ApiKeys" -> "API keys")
  function formatResource(str) {
    return str
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .toLowerCase()
      .replace(/\bapi\b/g, 'API');
  }
  
  // list{Name}s -> "Returns all {name}."
  const listMatch = name.match(/^list([A-Z][a-zA-Z]*)$/);
  if (listMatch) {
    const resource = formatResource(listMatch[1]);
    return `Returns all ${resource}.`;
  }
  
  // get{Name} -> "Returns the {name}, or null if not found."
  const getMatch = name.match(/^get([A-Z][a-zA-Z]*)$/);
  if (getMatch) {
    const resource = formatResource(getMatch[1]);
    return `Returns the ${resource}, or null if not found.`;
  }
  
  // use{Name}s (plural) -> "React hook that returns all {name}."
  const useListMatch = name.match(/^use([A-Z][a-zA-Z]*s)$/);
  if (useListMatch && !name.endsWith('ss')) {
    const resource = formatResource(useListMatch[1]);
    return `React hook that returns all ${resource}.`;
  }
  
  // use{Name} -> "React hook that returns the {name}."
  const useMatch = name.match(/^use([A-Z][a-zA-Z]*)$/);
  if (useMatch) {
    const resource = formatResource(useMatch[1]);
    return `React hook that returns the ${resource}.`;
  }
  
  return null;
}
// ============================================================

const TYPE_FORMAT_FLAGS =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseFullyQualifiedType |
  ts.TypeFormatFlags.WriteArrowStyleSignature;

// Flags for expanding type aliases inline in signatures
const TYPE_FORMAT_FLAGS_INLINE =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.InTypeAlias |
  ts.TypeFormatFlags.WriteArrayAsGenericType |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteArrowStyleSignature;

// Flags for keeping type references without expansion
const TYPE_FORMAT_FLAGS_NO_EXPAND =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.WriteArrowStyleSignature;

// Determine if a type should be expanded inline or kept as a reference
function shouldExpandType(type, checker) {
  const symbol = type.getSymbol();
  if (!symbol) return false;
  
  const name = symbol.getName();
  
  // Expand types that are clearly "configuration" or "options" objects
  if (name.endsWith('Options') || name.endsWith('Config') || name.endsWith('Props') || name.endsWith('Data')) {
    return true;
  }
  
  // Don't expand types that are likely documented entities
  // These patterns indicate domain objects that users should look up separately
  const entityPatterns = [
    'User', 'Team', 'Project', 'Permission', 'ApiKey', 'Connection', 
    'Channel', 'Session', 'Auth', 'Customer', 'Item', 'Email'
  ];
  
  for (const pattern of entityPatterns) {
    if (name.includes(pattern) && !name.endsWith('Options')) {
      return false;
    }
  }
  
  // Expand anonymous/inline types (no meaningful name)
  if (name === '__type' || name === '__object') {
    return true;
  }
  
  // Default: don't expand (keep as reference)
  return false;
}

// Function to expand type aliases and show inline object types
function expandType(type, checker, node) {
  // Check if it's an empty tuple type (represented as [])
  if (checker.isTupleType(type)) {
    const typeArgs = type.typeArguments || [];
    if (typeArgs.length === 0) {
      // Empty tuple - this represents no parameters
      return '[]';
    }
  }
  
  // Check if we should expand this type based on its name/symbol
  const symbol = type.getSymbol();
  if (symbol) {
    const shouldExpand = shouldExpandType(type, checker);
    
    if (!shouldExpand) {
      // Don't expand - keep as type reference
      return checker.typeToString(type, node, TYPE_FORMAT_FLAGS_NO_EXPAND);
    }
    
    // For type aliases that should be expanded, expand them
    const properties = checker.getPropertiesOfType(type);
    if (properties.length > 0 && properties.length < 20) {
      const props = properties.map(prop => {
        const propType = checker.getTypeOfSymbolAtLocation(prop, node);
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 ? '?' : '';
        // Use NO_EXPAND for property types to avoid recursive explosion
        return `${prop.getName()}${optional}: ${checker.typeToString(propType, node, TYPE_FORMAT_FLAGS_NO_EXPAND)}`;
      }).join('; ');
      return `{ ${props}; }`;
    }
  }
  
  // Handle anonymous intersection types (no symbol)
  if (type.flags & ts.TypeFlags.Intersection) {
    const types = type.types || [];
    
    // Check if any part contains Options/Config types
    const hasOptionsType = types.some(t => {
      const sym = t.getSymbol();
      if (!sym) return true; // Inline types
      const name = sym.getName();
      return name.endsWith('Options') || name.endsWith('Config') || name.endsWith('Data');
    });
    
    if (hasOptionsType) {
      return types.map(t => expandType(t, checker, node)).join(' & ');
    } else {
      // Entity intersection types like Team - keep as reference
      return checker.typeToString(type, node, TYPE_FORMAT_FLAGS_NO_EXPAND);
    }
  }
  
  // For inline object types (no symbol)
  if (type.flags & ts.TypeFlags.Object) {
    const properties = checker.getPropertiesOfType(type);
    if (properties.length > 0 && properties.length < 10) {
      const props = properties.map(prop => {
        const propType = checker.getTypeOfSymbolAtLocation(prop, node);
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 ? '?' : '';
        return `${prop.getName()}${optional}: ${checker.typeToString(propType, node, TYPE_FORMAT_FLAGS_INLINE)}`;
      }).join('; ');
      return `{ ${props}; }`;
    }
  }
  
  // Default to standard type string (keeps type aliases)
  return checker.typeToString(type, node, TYPE_FORMAT_FLAGS_NO_EXPAND);
}

// Extract property descriptions AND types from a type
function extractPropertyDescriptions(type, checker, node) {
  const propertyInfo = {};
  
  // Skip ALL tuple types (including named tuples like [scope: Team, id: string])
  if (checker.isTupleType(type)) {
    return propertyInfo;
  }
  
  // Check if we should extract descriptions for this type
  const symbol = type.getSymbol();
  if (symbol && !shouldExpandType(type, checker)) {
    // Don't extract - this is an entity type that should stay as a reference
    return propertyInfo;
  }
  
  // Don't extract from intersection types unless they contain Options types
  if (type.flags & ts.TypeFlags.Intersection) {
    const types = type.types || [];
    
    // Check if any part is an Options type
    const hasOptionsType = types.some(t => {
      const sym = t.getSymbol();
      if (!sym) return false;
      const name = sym.getName();
      return name.endsWith('Options') || name.endsWith('Config') || name.endsWith('Data');
    });
    
    if (hasOptionsType) {
      // Extract from Options types only
      for (const t of types) {
        Object.assign(propertyInfo, extractPropertyDescriptions(t, checker, node));
      }
    }
    
    return propertyInfo;
  }
  
  if (type.flags & ts.TypeFlags.Object) {
    // We already checked shouldExpandType above
    const properties = checker.getPropertiesOfType(type);
    for (const prop of properties) {
      const description = ts.displayPartsToString(prop.getDocumentationComment(checker));
      const propType = checker.getTypeOfSymbolAtLocation(prop, node);
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      
      propertyInfo[prop.getName()] = {
        type: checker.typeToString(propType, node, TYPE_FORMAT_FLAGS_NO_EXPAND),
        optional,
        description: description || undefined
      };
    }
  }
  
  return propertyInfo;
}

function readTsConfig(configPath) {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
}

/**
 * Check if a node has the @stackdoc JSDoc tag
 * This allows developers to explicitly mark items for SDK documentation
 */
function hasStackDocTag(node) {
  if (!node) return false;
  const jsDocs = ts.getJSDocTags(node);
  return jsDocs.some(tag => tag.tagName.text === 'stackdoc');
}

/**
 * Check if a node has the @internal JSDoc tag
 * Items marked as @internal will be excluded from docs
 */
function hasInternalTag(node) {
  if (!node) return false;
  const jsDocs = ts.getJSDocTags(node);
  return jsDocs.some(tag => tag.tagName.text === 'internal');
}

function includeDeclaration(filePath) {
  const relative = path.relative(SRC_DIR, filePath);
  if (relative.startsWith('lib/stack-app')) return true;
  if (relative.startsWith('lib/hooks')) return true;
  return false;
}

function getCategory(name, declaration) {
  if (name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase()) {
    return 'hooks';
  }
  const relative = path.relative(SRC_DIR, declaration.getSourceFile().fileName);
  if (relative.startsWith('lib/stack-app/apps')) {
    return 'objects';
  }
  if (ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
    // Check if this is a mixin type
    if (MIXIN_TYPES.has(name)) {
      return 'mixins';
    }
    return 'types';
  }
  return 'objects';
}

function getKind(declaration) {
  switch (declaration.kind) {
    case ts.SyntaxKind.InterfaceDeclaration:
      return 'interface';
    case ts.SyntaxKind.TypeAliasDeclaration:
      return 'type';
    case ts.SyntaxKind.FunctionDeclaration:
      return 'function';
    case ts.SyntaxKind.VariableDeclaration:
      return 'variable';
    case ts.SyntaxKind.ClassDeclaration:
      return 'class';
    case ts.SyntaxKind.EnumDeclaration:
      return 'enum';
    default:
      return ts.SyntaxKind[declaration.kind] || 'unknown';
  }
}

function normaliseTags(tags) {
  const results = tags.map(tag => {
    let text;
    if (Array.isArray(tag.text)) {
      text = tag.text.map(part => part.text).join('');
    } else {
      text = tag.text;
    }
    return {
      name: tag.name,
      text: text || undefined,
    };
  }).filter(tag => tag.text !== undefined);
  return results.length ? results : undefined;
}

function extractPlatformTags(node) {
  if (!node) return undefined;
  const sourceFile = node.getSourceFile();
  const text = sourceFile.getFullText();
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, node.getFullStart()) || []),
    ...(ts.getTrailingCommentRanges(text, node.getEnd()) || []),
  ];

  const platforms = new Set();
  for (const range of ranges) {
    const comment = text.slice(range.pos, range.end);
    const matches = comment.matchAll(/PLATFORM\s+([a-zA-Z0-9-]+)/g);
    for (const match of matches) {
      platforms.add(match[1]);
    }
  }

  return platforms.size ? Array.from(platforms) : undefined;
}

function printers() {
  const printer = ts.createPrinter({ removeComments: false });
  return {
    print(node) {
      return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
    }
  };
}

const { print } = printers();

function selectDeclaration(declarations, preferredSourcePath) {
  if (!declarations || !declarations.length) return undefined;
  if (!preferredSourcePath) return declarations[0];
  const preferred = declarations.find(decl => path.relative(ROOT_DIR, decl.getSourceFile().fileName) === preferredSourcePath);
  return preferred || declarations[0];
}

function createBaseEntry(symbol, declaration, checker) {
  const sourceFile = declaration.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(declaration.getStart());
  const description = ts.displayPartsToString(symbol.getDocumentationComment(checker));
  const tags = normaliseTags(symbol.getJsDocTags());
  const entry = {
    name: symbol.getName(),
    kind: getKind(declaration),
    sourcePath: path.relative(ROOT_DIR, sourceFile.fileName),
    line: position.line + 1,
  };
  if (description) entry.description = description;
  if (tags) entry.tags = tags;
  return entry;
}

function gatherMixinsFromTypeNode(node, mixins) {
  if (!node) return;
  if (ts.isIntersectionTypeNode(node)) {
    node.types.forEach(typeNode => gatherMixinsFromTypeNode(typeNode, mixins));
    return;
  }
  if (ts.isTypeLiteralNode(node)) {
    return;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    gatherMixinsFromTypeNode(node.type, mixins);
    return;
  }
  mixins.push(node.getText());
}

/**
 * Extract member names that are explicitly defined in the type's own body
 * (not inherited from mixins/parent types).
 * 
 * For a type like:
 *   type ServerTeam = { createdAt: Date; addUser(): void; } & Team;
 * 
 * This returns ['createdAt', 'addUser'] - the members defined inline,
 * NOT the members inherited from Team.
 */
function gatherOwnMemberNames(node, memberNames) {
  if (!node) return;
  
  if (ts.isIntersectionTypeNode(node)) {
    // For intersection types, only gather from type literals (inline definitions)
    node.types.forEach(typeNode => gatherOwnMemberNames(typeNode, memberNames));
    return;
  }
  
  if (ts.isTypeLiteralNode(node)) {
    // This is an inline object type - extract its member names
    node.members.forEach(member => {
      if (ts.isPropertySignature(member) || ts.isMethodSignature(member)) {
        const name = member.name;
        if (name && ts.isIdentifier(name)) {
          memberNames.push(name.text);
        }
      }
    });
    return;
  }
  
  if (ts.isParenthesizedTypeNode(node)) {
    gatherOwnMemberNames(node.type, memberNames);
    return;
  }
  
  // For type references (like `Team`, `BaseUser`), we don't extract members
  // because those are inherited, not "own" members
}

function buildMemberEntry(symbol, parentDeclaration, checker) {
  const declarations = symbol.getDeclarations() || [];
  const parentPath = path.relative(ROOT_DIR, parentDeclaration.getSourceFile().fileName);
  const declaration = selectDeclaration(declarations, parentPath);
  const fallbackNode = declaration || parentDeclaration;
  const sourceFile = declaration && declaration.getSourceFile();
  const location = declaration && sourceFile.getLineAndCharacterOfPosition(declaration.getStart());
  
  // Try to get description from symbol first, then fallback to AST JSDoc nodes
  // (needed for properties in type literals within intersection types)
  let description = ts.displayPartsToString(symbol.getDocumentationComment(checker));
  let tags = normaliseTags(symbol.getJsDocTags());
  
  if (!description && declaration) {
    const jsDocNodes = ts.getJSDocCommentsAndTags(declaration);
    for (const jsDoc of jsDocNodes) {
      if (ts.isJSDoc(jsDoc) && jsDoc.comment) {
        // Extract comment text
        if (typeof jsDoc.comment === 'string') {
          description = jsDoc.comment;
        } else if (Array.isArray(jsDoc.comment)) {
          description = jsDoc.comment.map(part => part.text || '').join('');
        }
        // Also extract tags from this JSDoc node
        if (jsDoc.tags && jsDoc.tags.length > 0 && (!tags || tags.length === 0)) {
          tags = normaliseTags(jsDoc.tags.map(tag => ({
            name: tag.tagName.text,
            text: tag.comment ? (typeof tag.comment === 'string' ? tag.comment : tag.comment.map(p => p.text).join('')) : ''
          })));
        }
        break;
      }
    }
  }
  const symbolType = checker.getTypeOfSymbolAtLocation(symbol, fallbackNode);
  const callSignatures = symbolType.getCallSignatures();
  
  const name = symbol.getName();
  
  // Skip internal members (prefix with underscore)
  if (name.startsWith('_')) {
    return null;
  }

  // If no description, try to extract from @deprecated tag text
  // (some JSDoc puts the description after @deprecated "Use X instead.")
  if (!description && tags && tags.length > 0) {
    const deprecatedTagIndex = tags.findIndex(t => t.name === 'deprecated');
    if (deprecatedTagIndex !== -1) {
      const deprecatedTag = tags[deprecatedTagIndex];
      if (deprecatedTag.text) {
        const text = deprecatedTag.text;
        // Match "Use X instead." at the start, followed by description
        const useMatch = text.match(/^(Use [^.]+\.)\s*(.+)/s);
        if (useMatch && useMatch[2]) {
          description = useMatch[2].trim();
          // Update the deprecated tag to only contain "Use X instead."
          tags[deprecatedTagIndex] = { ...deprecatedTag, text: useMatch[1] };
        } else if (!text.toLowerCase().startsWith('use ')) {
          // If it doesn't start with "Use", the whole text might be the description
          description = text;
          // Clear the deprecated tag text since we used it as description
          tags[deprecatedTagIndex] = { ...deprecatedTag, text: '' };
        }
      }
    }
  }
  
  // Auto-generate descriptions for AsyncStoreProperty-style methods (last resort)
  if (!description) {
    description = generateAsyncStorePropertyDescription(name);
  }

  const entry = {
    name,
    optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
  };

  if (description) entry.description = description;
  if (tags) entry.tags = tags;
  if (declaration) {
    entry.sourcePath = path.relative(ROOT_DIR, declaration.getSourceFile().fileName);
    entry.line = location.line + 1;
    const platforms = extractPlatformTags(declaration);
    if (platforms) entry.platforms = platforms;
  }

  if (callSignatures.length > 0) {
    entry.kind = 'method';
    const allSignatures = callSignatures.map(signature => {
      const parameters = signature.getParameters()
        .map(paramSymbol => {
          const paramDecl = paramSymbol.valueDeclaration || (paramSymbol.declarations && paramSymbol.declarations[0]);
          const paramType = checker.getTypeOfSymbolAtLocation(paramSymbol, paramDecl || fallbackNode);
          const expandedType = expandType(paramType, checker, paramDecl || fallbackNode);
          const optional = (paramSymbol.flags & ts.SymbolFlags.Optional) !== 0 ||
            (!!paramDecl && ts.isParameter(paramDecl) && !!paramDecl.questionToken);
          
          // Skip empty tuple parameters (these represent no actual parameters)
          if (expandedType === '[]') {
            return null;
          }
          
          // Extract property descriptions for object types
          const propertyDescriptions = extractPropertyDescriptions(paramType, checker, paramDecl || fallbackNode);
          
          const param = {
            name: paramSymbol.getName(),
            type: expandedType,
            optional,
          };
          
          // Only add propertyDescriptions if there are any
          if (Object.keys(propertyDescriptions).length > 0) {
            param.propertyDescriptions = propertyDescriptions;
          }
          
          return param;
        })
        .filter(p => p !== null);
      
      // Build signature string with expanded types
      const paramStrings = parameters.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`);
      
      // Try to get return type from source annotation if available
      let returnType;
      if (declaration && ts.isFunctionDeclaration(declaration) && declaration.type) {
        // Use the source annotation directly
        returnType = declaration.type.getText();
      } else if (declaration && ts.isMethodSignature(declaration) && declaration.type) {
        returnType = declaration.type.getText();
      } else if (declaration && ts.isPropertySignature(declaration) && declaration.type) {
        // For property signatures, try to extract return type
        const typeNode = declaration.type;
        if (ts.isFunctionTypeNode(typeNode) && typeNode.type) {
          returnType = typeNode.type.getText();
        } else {
          // Don't expand return types - keep type aliases
          returnType = checker.typeToString(
            signature.getReturnType(), 
            fallbackNode, 
            ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature
          );
        }
      } else {
        // Fallback to checker - don't expand type aliases in return types
        returnType = checker.typeToString(
          signature.getReturnType(), 
          fallbackNode, 
          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature
        );
      }
      
      const signatureString = `(${paramStrings.join(', ')}) => ${returnType}`;
      
      return {
        signature: signatureString,
        parameters,
        returnType,
      };
    });
    
    // Filter out tuple-based signatures (e.g., args: [param1, param2])
    // These come from AsyncStoreProperty and are less user-friendly
    const nonTupleSignatures = allSignatures.filter(sig => {
      // Check if any parameter is a tuple type
      const hasTupleParam = sig.parameters.some(p => p.type.match(/^\[.+\]$/));
      return !hasTupleParam;
    });
    
    // If there are only tuple signatures, try to unpack them
    let signaturesToUse = nonTupleSignatures;
    
    if (nonTupleSignatures.length === 0 && allSignatures.length > 0) {
      // Try to unpack tuple signatures like args: [param1: Type1, param2?: Type2]
      const unpackedSignatures = allSignatures.map(sig => {
        if (sig.parameters.length === 1 && sig.parameters[0].type.match(/^\[.+\]$/)) {
          // This is a tuple parameter - try to unpack it
          const tupleParam = sig.parameters[0];
          // Parse the tuple: [param1: Type1, param2?: Type2] -> extract individual params
          const tupleContent = tupleParam.type.slice(1, -1); // Remove [ ]
          
          // Unpack the tuple signature
          // From: (args: [options?: Type]) => Return
          // To: (options?: Type) => Return
          const unpackedSignature = sig.signature.replace(/\(args: \[(.+?)\]\)/, '($1)');
          
          return {
            ...sig,
            signature: unpackedSignature,
            parameters: [] // Simplified for now - could parse tuple content
          };
        }
        return sig;
      });
      
      signaturesToUse = unpackedSignatures;
    }
    
    // Deduplicate signatures by normalizing Server* types
    const normalizeServerTypes = (sig) => {
      return sig.replace(/Server(ContactChannel|User|Team|Permission|ApiKey|Item|Project|Email)/g, '$1');
    };
    
    const seenSignatures = new Set();
    const uniqueSignatures = [];
    
    // Process signatures in reverse (keep most specific ones)
    for (let i = signaturesToUse.length - 1; i >= 0; i--) {
      const sig = signaturesToUse[i];
      const normalized = normalizeServerTypes(sig.signature);
      
      if (!seenSignatures.has(normalized)) {
        seenSignatures.add(normalized);
        uniqueSignatures.unshift(sig); // Add to beginning to maintain order
      }
    }
    
    entry.signatures = uniqueSignatures;
  } else {
    entry.kind = 'property';
    entry.type = checker.typeToString(symbolType, fallbackNode, TYPE_FORMAT_FLAGS);
  }

  return entry;
}

function buildTypeEntry(symbol, declaration, checker) {
  const base = createBaseEntry(symbol, declaration, checker);
  const declaredType = checker.getDeclaredTypeOfSymbol(symbol);
  const parentPath = base.sourcePath;
  const members = checker
    .getPropertiesOfType(declaredType)
    .map(propSymbol => buildMemberEntry(propSymbol, declaration, checker));

  const sortedMembers = members
    .filter(member => member !== null) // Filter out internal members
    .map(member => ({
      member,
      priority: member.sourcePath
        ? (member.sourcePath === parentPath ? 0 : 1)
        : 2,
      order: member.line ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) =>
      a.priority - b.priority ||
      a.order - b.order ||
      a.member.name.localeCompare(b.member.name),
    )
    .map(item => item.member);

  const entry = {
    ...base,
    category: 'types',
    definition: print(declaration).trim(),
    members: sortedMembers,
  };

  if (ts.isInterfaceDeclaration(declaration) && declaration.heritageClauses) {
    const extendsList = declaration.heritageClauses
      .filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap(clause => clause.types.map(type => type.getText()));
    if (extendsList.length) {
      entry.extends = extendsList;
    }
  }

  if (ts.isTypeAliasDeclaration(declaration)) {
    const mixins = [];
    gatherMixinsFromTypeNode(declaration.type, mixins);
    if (mixins.length) {
      entry.mixins = mixins;
    }
    
    // Extract member names that are explicitly defined in this type's body
    // (not inherited from mixins)
    const ownMemberNames = [];
    gatherOwnMemberNames(declaration.type, ownMemberNames);
    if (ownMemberNames.length) {
      entry.ownMemberNames = ownMemberNames;
    }
  }

  return entry;
}

function buildGeneralEntry(symbol, declaration, checker, category) {
  const base = createBaseEntry(symbol, declaration, checker);
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const callSignatures = type.getCallSignatures();
  const constructSignatures = type.getConstructSignatures();

  const entry = {
    ...base,
    category,
    type: checker.typeToString(type, declaration, TYPE_FORMAT_FLAGS),
    declaration: print(declaration).trim(),
  };

  const signatures = [...callSignatures, ...constructSignatures].map(sig =>
    checker.signatureToString(sig, declaration, TYPE_FORMAT_FLAGS),
  );
  if (signatures.length) {
    entry.signatures = signatures;
  }

  return entry;
}

function mapToRecord(map) {
  const record = {};
  const entries = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    record[entry.name] = entry;
  }
  return record;
}

function collectDocs() {
  const parsed = readTsConfig(TSCONFIG_PATH);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const checker = program.getTypeChecker();
  const processed = new Set();
  const results = {
    objects: new Map(),
    types: new Map(),
    hooks: new Map(),
    mixins: new Map(),
  };

  const entryFile = program.getSourceFile(path.join(SRC_DIR, 'index.ts'));
  if (!entryFile) {
    throw new Error('Could not find src/index.ts');
  }
  const entrySymbol = checker.getSymbolAtLocation(entryFile);
  if (!entrySymbol) {
    throw new Error('Could not resolve exports for src/index.ts');
  }

  const exportedSymbols = checker.getExportsOfModule(entrySymbol);
  for (const exported of exportedSymbols) {
    let symbol = exported;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const declarations = symbol.getDeclarations() || [];
    for (const declaration of declarations) {
      const fileName = declaration.getSourceFile().fileName;
      if (!fileName.startsWith(SRC_DIR)) continue;
      if (!includeDeclaration(fileName)) continue;

      // Tag-based filtering
      if (USE_TAG_FILTER) {
        if (TAG_FILTER_MODE === 'opt-in') {
          // Opt-in mode: only include items with @stackdoc tag
          if (!hasStackDocTag(declaration)) {
            continue;
          }
        } else if (TAG_FILTER_MODE === 'opt-out') {
          // Opt-out mode: exclude items with @internal tag
          if (hasInternalTag(declaration)) {
            continue;
          }
        }
      }

      const key = `${path.relative(SRC_DIR, fileName)}::${symbol.getName()}::${declaration.pos}`;
      if (processed.has(key)) continue;
      processed.add(key);

      const category = getCategory(symbol.getName(), declaration);
      if (category === 'types' || category === 'mixins') {
        const entry = buildTypeEntry(symbol, declaration, checker);
        results[category].set(entry.name, entry);
      } else {
        const entry = buildGeneralEntry(symbol, declaration, checker, category);
        results[category].set(entry.name, entry);
      }
    }
  }

  return {
    objects: mapToRecord(results.objects),
    types: mapToRecord(results.types),
    hooks: mapToRecord(results.hooks),
    mixins: mapToRecord(results.mixins),
  };
}

function main() {
  const docs = collectDocs();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const category of ['objects', 'types', 'hooks', 'mixins']) {
    const filePath = path.join(OUTPUT_DIR, `${category}.json`);
    fs.writeFileSync(filePath, JSON.stringify(docs[category], null, 2));
  }
  console.log(`SDK docs JSON generated at ${OUTPUT_DIR}`);
}

main();
