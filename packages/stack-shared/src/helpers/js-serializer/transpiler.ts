import * as babel from '@babel/core';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { ASYNC_TO_GENERATOR_RUNTIME, REGENERATOR_RUNTIME } from './runtime-strings';
import { getSerializationHelpers } from './serialization-helpers';

/**
 * Bundle runtime helpers and replace imports with local references
 */
function bundleRuntimeHelpers(code: string): string {
  // Start with just the code, we'll add runtime and markers
  let modifiedCode = code;
  let runtimeCode = '';

  // Check if we need async helpers
  const needsAsyncHelpers = code.includes('import _asyncToGenerator');

  if (needsAsyncHelpers) {
    // Remove the import statement
    modifiedCode = modifiedCode.replace(
      /import\s+_asyncToGenerator\s+from\s+["']@babel\/runtime\/helpers\/asyncToGenerator["'];?\s*/g,
      ''
    );

    // Add helper to runtime section
    runtimeCode += ASYNC_TO_GENERATOR_RUNTIME + '\n';
  }

  // Handle regenerator runtime import - replace with inline runtime
  const needsRegenerator = modifiedCode.includes('import _regeneratorRuntime');
  if (needsRegenerator) {
    modifiedCode = modifiedCode.replace(
      /import\s+_regeneratorRuntime\s+from\s+["']@babel\/runtime\/regenerator["'];?\s*/g,
      ''
    );
    // Add regenerator runtime to runtime section
    runtimeCode += `(() => { ${REGENERATOR_RUNTIME} })();\n\nconst _regeneratorRuntime = regeneratorRuntime;\n`;
  }

  // Combine runtime and user code with clear marker
  if (runtimeCode) {
    modifiedCode = runtimeCode + "\n// USER_CODE_START\n\n" + modifiedCode;
  } else {
    modifiedCode = "// USER_CODE_START\n\n" + modifiedCode;
  }

  return modifiedCode;
}

/**
 * Transform async functions to generators and generators to use regenerator runtime
 * This combines both transformations for better optimization
 */
function transformAsyncAndGenerators(code: string): string {
  const result = babel.transformSync(code, {
    plugins: [
      ['@babel/plugin-transform-for-of'],
      ['@babel/plugin-transform-async-to-generator'],
      ['@babel/plugin-transform-regenerator', {
        asyncGenerators: true,
        generators: true,
        async: true
      }],
      ['@babel/plugin-transform-runtime', {
        regenerator: true,
        helpers: true,
        useESModules: false
      }]
    ],
    parserOpts: {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    },
    generatorOpts: {
      retainLines: false,
      compact: false
    }
  });

  return result?.code || code;
}

/**
 * Transform objects with getters/setters to use Object.defineProperty
 */
function transformGettersSetters(code: string): string {
  const plugin: babel.PluginObj = {
    name: 'transform-getters-setters',
    visitor: {
      ObjectExpression: {
        exit(path) {
          // Check if this object has getters or setters
          const hasGettersOrSetters = path.node.properties.some(prop =>
            t.isObjectMethod(prop) && (prop.kind === 'get' || prop.kind === 'set')
          );

          if (hasGettersOrSetters) {
            transformObjectWithGettersSetters(path);
          }
        }
      }
    }
  };

  function transformObjectWithGettersSetters(path: babel.NodePath<t.ObjectExpression>) {
    const objectNode = path.node;

    // Group getters and setters by property name
    const propertyDescriptors = new Map<string, {
      get?: t.ObjectMethod,
      set?: t.ObjectMethod,
      key: t.Expression | t.Identifier | t.StringLiteral | t.NumericLiteral | t.BigIntLiteral | t.DecimalLiteral | t.PrivateName,
    }>();
    const regularProperties: any[] = [];

    // First pass: categorize properties
    for (const prop of objectNode.properties) {
      if (t.isObjectMethod(prop) && (prop.kind === 'get' || prop.kind === 'set')) {
        const keyName = getKeyName(prop.key);
        if (!propertyDescriptors.has(keyName)) {
          propertyDescriptors.set(keyName, { key: prop.key });
        }
        const descriptor = propertyDescriptors.get(keyName)!;
        if (prop.kind === 'get') {
          descriptor.get = prop;
        } else {
          descriptor.set = prop;
        }
      } else if (t.isObjectMethod(prop)) {
        // Transform regular methods to function expressions
        const funcExpr = t.functionExpression(
          null,
          prop.params,
          prop.body as t.BlockStatement,
          prop.generator,
          prop.async
        );
        regularProperties.push(
          t.objectProperty(
            prop.key,
            funcExpr,
            prop.computed,
            false
          )
        );
      } else {
        regularProperties.push(prop);
      }
    }

    // If no getters/setters, just process regular properties
    if (propertyDescriptors.size === 0) {
      return;
    }

    // Create IIFE that builds the object with Object.defineProperty calls
    const objIdentifier = t.identifier('_obj');
    const statements: t.Statement[] = [];

    // Create object with regular properties
    statements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          objIdentifier,
          t.objectExpression(regularProperties)
        )
      ])
    );

    // Add Object.defineProperty calls for each getter/setter
    for (const [keyName, descriptor] of propertyDescriptors) {
      const descriptorObj: t.ObjectProperty[] = [];

      if (descriptor.get) {
        const funcExpr = t.functionExpression(
          null,
          descriptor.get.params,
          descriptor.get.body as t.BlockStatement,
          descriptor.get.generator,
          descriptor.get.async
        );
        descriptorObj.push(
          t.objectProperty(
            t.identifier('get'),
            funcExpr
          )
        );
      }

      if (descriptor.set) {
        const funcExpr = t.functionExpression(
          null,
          descriptor.set.params,
          descriptor.set.body as t.BlockStatement,
          descriptor.set.generator,
          descriptor.set.async
        );
        descriptorObj.push(
          t.objectProperty(
            t.identifier('set'),
            funcExpr
          )
        );
      }

      // Add enumerable and configurable
      descriptorObj.push(
        t.objectProperty(t.identifier('enumerable'), t.booleanLiteral(true)),
        t.objectProperty(t.identifier('configurable'), t.booleanLiteral(true))
      );

      const keyArg = t.isIdentifier(descriptor.key) || t.isStringLiteral(descriptor.key)
        ? t.stringLiteral(keyName)
        : t.isPrivateName(descriptor.key)
          ? t.stringLiteral(descriptor.key.id.name)
          : descriptor.key as t.Expression;

      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier('Object'),
              t.identifier('defineProperty')
            ),
            [
              objIdentifier,
              keyArg,
              t.objectExpression(descriptorObj)
            ]
          )
        )
      );
    }

    // Return the object
    statements.push(t.returnStatement(objIdentifier));

    // Create IIFE
    const iife = t.callExpression(
      t.arrowFunctionExpression(
        [],
        t.blockStatement(statements)
      ),
      []
    );

    path.replaceWith(iife);
    path.skip();
  }

  function getKeyName(key: t.Expression | t.Identifier | t.StringLiteral | t.NumericLiteral | t.BigIntLiteral | t.DecimalLiteral | t.PrivateName): string {
    if (t.isIdentifier(key)) {
      return key.name;
    } else if (t.isStringLiteral(key)) {
      return key.value;
    } else if (t.isNumericLiteral(key)) {
      return String(key.value);
    }
    // For computed or other key types, generate a unique name
    return '__computed_' + Math.random().toString(36).substr(2, 9);
  }

  const result = babel.transformSync(code, {
    plugins: [plugin],
    parserOpts: {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    },
    generatorOpts: {
      retainLines: false,
      compact: false
    }
  });

  return result?.code || code;
}

/**
 * Wrap functions with __registerFunction
 */
function wrapFunctions(code: string): string {
  const plugin: babel.PluginObj = {
    name: 'wrap-functions-with-register',
    visitor: {
      FunctionExpression: {
        exit(path) {
          // Skip if this is a scope lambda function in registerFunction/registerClass options
          if (isScopeLambdaInRegisterCall(path)) {
            return;
          }
          transformFunction(path);
        }
      },
      ArrowFunctionExpression: {
        exit(path) {
          // Skip if this is a scope lambda function in registerFunction/registerClass options
          if (isScopeLambdaInRegisterCall(path)) {
            return;
          }
          transformFunction(path);
        }
      },
      FunctionDeclaration(path) {
        // Keep function declaration as-is and add registerFunction call after
        const { node } = path;
        if (node.id) {
          // Collect scope variables for the function
          const scopeVars = collectScopeVariables(path);

          // Generate the source string with scope variables replaced
          const sourceString = generateSourceWithScopeReplaced(node, scopeVars);

          // Create the scope object
          const scopeProperties = Array.from(scopeVars).map(varName =>
            t.objectProperty(
              t.identifier(varName),
              t.identifier(varName),
              false,
              true // shorthand
            )
          );

          const scopeObj = t.objectExpression(scopeProperties);

          // Wrap scope object in a lambda function
          const scopeLambda = t.arrowFunctionExpression(
            [],
            scopeObj
          );

          // Create the options object with scope and source
          const optionsProperties = [
            t.objectProperty(
              t.identifier('scope'),
              scopeLambda
            )
          ];

          // Add source property
          optionsProperties.push(
            t.objectProperty(
              t.identifier('source'),
              t.stringLiteral(sourceString)
            )
          );

          const optionsObj = t.objectExpression(optionsProperties);

          // Create a registerFunction call (no reassignment needed)
          const registerCall = t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.identifier('__STACK_SerializableJs'),
                t.identifier('registerFunction')
              ),
              [t.identifier(node.id.name), optionsObj]
            )
          );

          // Insert the registerFunction call after the function declaration
          path.insertAfter(registerCall);
        }
      },
      ObjectMethod(path) {
        // Transform regular object methods (not getters/setters)
        const { node } = path;
        if (node.kind === 'get' || node.kind === 'set') {
          // Skip getters/setters - they're handled in separate step
          return;
        }

        const funcExpr = t.functionExpression(
          null,
          node.params,
          node.body as t.BlockStatement,
          node.generator,
          node.async
        );

        const wrappedFunc = wrapWithRegisterFunction(funcExpr, path);

        path.replaceWith(
          t.objectProperty(
            node.key,
            wrappedFunc,
            node.computed,
            false
          )
        );
        path.skip();
      },
      ClassMethod(path) {
        // Skip all class methods - they'll be handled as part of the class
        // Getters, setters, constructors, and regular methods all stay as-is
        return;
      },
      ClassDeclaration: {
        exit(path) {
          transformClass(path);
        }
      },
      ClassExpression: {
        exit(path) {
          transformClass(path);
        }
      }
    }
  };

  function isScopeLambdaInRegisterCall(path: babel.NodePath): boolean {
    // Check if this is a scope property
    const parent = path.parent;
    if (!t.isObjectProperty(parent) ||
        !t.isIdentifier(parent.key) ||
        parent.key.name !== 'scope') {
      return false;
    }

    // Check if the parent object is the options argument to registerFunction/registerClass
    const grandParent = path.parentPath?.parent;
    if (!t.isObjectExpression(grandParent)) {
      return false;
    }

    // Check if this object is the second argument to a registerFunction/registerClass call
    const greatGrandParent = path.parentPath?.parentPath?.parent;
    if (!t.isCallExpression(greatGrandParent) || greatGrandParent.arguments[1] !== grandParent) {
      return false;
    }

    // Check if the call is to __STACK_SerializableJs.registerFunction or registerClass
    if (!t.isMemberExpression(greatGrandParent.callee) ||
        !t.isIdentifier(greatGrandParent.callee.object) ||
        greatGrandParent.callee.object.name !== '__STACK_SerializableJs' ||
        !t.isIdentifier(greatGrandParent.callee.property) ||
        (greatGrandParent.callee.property.name !== 'registerFunction' &&
         greatGrandParent.callee.property.name !== 'registerClass')) {
      return false;
    }

    return true;
  }

  function transformFunction(path: babel.NodePath<t.FunctionExpression | t.ArrowFunctionExpression>) {
    // Don't transform if already wrapped
    if (t.isCallExpression(path.parent) &&
        t.isMemberExpression(path.parent.callee) &&
        t.isIdentifier(path.parent.callee.object) &&
        path.parent.callee.object.name === '__STACK_SerializableJs' &&
        t.isIdentifier(path.parent.callee.property) &&
        path.parent.callee.property.name === 'registerFunction') {
      return;
    }

    const wrapped = wrapWithRegisterFunction(path.node, path);
    path.replaceWith(wrapped);
  }

  // Remove the old transformObjectWithGettersSetters and getKeyName functions - they're now in transformGettersSetters

  function transformClass(path: babel.NodePath<t.ClassDeclaration | t.ClassExpression>) {
    const { node } = path;

    // Collect all variables in scope for the class
    const scopeVars = collectScopeVariables(path);

    // Generate the source string with scope variables replaced
    const sourceString = generateSourceWithScopeReplaced(node, scopeVars);

    // Create the scope object
    const scopeProperties = Array.from(scopeVars).map(varName =>
      t.objectProperty(
        t.identifier(varName),
        t.identifier(varName),
        false,
        true // shorthand
      )
    );

    const scopeObj = t.objectExpression(scopeProperties);

    // Wrap scope object in a lambda function
    const scopeLambda = t.arrowFunctionExpression(
      [],
      scopeObj
    );

    // Create the options object with scope and source
    const optionsProperties = [
      t.objectProperty(
        t.identifier('scope'),
        scopeLambda
      )
    ];

    // Add source property
    optionsProperties.push(
      t.objectProperty(
        t.identifier('source'),
        t.stringLiteral(sourceString)
      )
    );

    const optionsObj = t.objectExpression(optionsProperties);

    if (t.isClassDeclaration(node)) {
      // For class declarations, add a separate registerClass call after the class
      const className = node.id;
      if (!className) {
        // Anonymous class declaration (shouldn't happen, but handle it)
        return;
      }

      // Create the registerClass call (no reassignment needed)
      const registerCall = t.expressionStatement(
        t.callExpression(
          t.memberExpression(
            t.identifier('__STACK_SerializableJs'),
            t.identifier('registerClass')
          ),
          [t.identifier(className.name), optionsObj]
        )
      );

      // Insert the registerClass call after the class declaration
      path.insertAfter(registerCall);
    } else {
      // For class expressions, wrap the class with registerClass
      const wrappedClass = t.callExpression(
        t.memberExpression(
          t.identifier('__STACK_SerializableJs'),
          t.identifier('registerClass')
        ),
        [node, optionsObj]
      );

      path.replaceWith(wrappedClass);
      path.skip();
    }
  }

  // Remove the old transformClassGettersSetters function content
  // This function is no longer needed as we're not transforming getters/setters
  function OLD_transformClassGettersSetters_REMOVED(path: babel.NodePath<t.ClassDeclaration | t.ClassExpression>) {
    // This function has been removed - classes are now handled by transformClass

    // Function content removed - handled in new transformClass above
  }

  function wrapWithRegisterFunction(
    func: t.FunctionExpression | t.ArrowFunctionExpression,
    path: babel.NodePath
  ): t.CallExpression {
    // Collect all variables in scope
    const scopeVars = collectScopeVariables(path);

    // Generate the source string with scope variables replaced
    const sourceString = generateSourceWithScopeReplaced(func, scopeVars);

    // Create the scope object
    const scopeProperties = Array.from(scopeVars).map(varName =>
      t.objectProperty(
        t.identifier(varName),
        t.identifier(varName),
        false,
        true // shorthand
      )
    );

    const scopeObj = t.objectExpression(scopeProperties);

    // Wrap scope object in a lambda function
    const scopeLambda = t.arrowFunctionExpression(
      [],
      scopeObj
    );

    // Create the options object with scope and source
    const optionsProperties = [
      t.objectProperty(
        t.identifier('scope'),
        scopeLambda
      )
    ];

    // Add source property
    optionsProperties.push(
      t.objectProperty(
        t.identifier('source'),
        t.stringLiteral(sourceString)
      )
    );

    const optionsObj = t.objectExpression(optionsProperties);

    // Create the __STACK_SerializableJs.registerFunction call
    return t.callExpression(
      t.memberExpression(
        t.identifier('__STACK_SerializableJs'),
        t.identifier('registerFunction')
      ),
      [func, optionsObj]
    );
  }

  function collectScopeVariables(path: babel.NodePath): Set<string> {
    const scopeVars = new Set<string>();
    const functionScope = path.scope;

    // Traverse the function to find all referenced identifiers
    path.traverse({
      Identifier(idPath: any) {
        const name = idPath.node.name;

        // Skip if it's not a referenced identifier
        if (!idPath.isReferencedIdentifier()) {
          return;
        }

        // Get the binding for this identifier
        const binding = idPath.scope.getBinding(name);

        if (!binding) {
          // No binding found - might be a global
          return;
        }

        // Check if the binding is from outside this function's scope
        // We want to capture variables that are:
        // 1. Defined outside the function
        // 2. Not parameters of this function
        // 3. Not defined within this function

        // The binding.scope tells us where the variable was defined
        // If it's not the same as or a child of our function scope, it's external
        if (!isInScope(binding.scope, functionScope)) {
          scopeVars.add(name);
        }
      }
    });

    return scopeVars;
  }

  function isInScope(testScope: any, targetScope: any): boolean {
    let current = testScope;
    while (current) {
      if (current === targetScope) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function generateSourceWithScopeReplaced(
    func: t.FunctionExpression | t.ArrowFunctionExpression | t.FunctionDeclaration | t.ClassDeclaration | t.ClassExpression,
    scopeVars: Set<string>
  ): string {
    // Clone the function node to avoid mutating the original
    const clonedFunc = t.cloneNode(func, true);

    // For anonymous function expressions, we need to wrap them in parentheses to make valid syntax
    let codeToTransform: string;
    const generateOptions = {
      comments: false,  // Don't include comments
      compact: true,    // Minimize whitespace
    };

    if (t.isFunctionExpression(clonedFunc) && !clonedFunc.id) {
      // Wrap anonymous function expression in parentheses
      codeToTransform = '(' + generate(clonedFunc, generateOptions).code + ')';
    } else {
      codeToTransform = generate(clonedFunc, generateOptions).code;
    }

    // Create a visitor to replace scope variable references
    const replaceVisitor: babel.Visitor = {
      Identifier(path) {
        const name = path.node.name;

        // Only replace if it's a referenced identifier and in our scope vars
        if (path.isReferencedIdentifier() && scopeVars.has(name)) {
          // Check if the binding is local to this function
          const binding = path.scope.getBinding(name);

          // If there's no binding or the binding is from outside, replace it
          if (!binding || !isInScope(binding.scope, path.getFunctionParent()?.scope)) {
            // Replace with __$getFromScope("varName")
            path.replaceWith(
              t.callExpression(
                t.identifier('__$getFromScope'),
                [t.stringLiteral(name)]
              )
            );
            path.skip();
          }
        }
      }
    };

    // Transform the code
    const result = babel.transformSync(codeToTransform, {
      plugins: [
        () => ({
          visitor: replaceVisitor
        })
      ],
      parserOpts: {
        sourceType: 'module',
        plugins: ['jsx', 'typescript']
      },
      generatorOpts: {
        retainLines: false,
        compact: true,
      }
    });

    // Remove trailing semicolon if present (since we're generating expressions, not statements)
    let sourceCode = result?.code || '';
    if (sourceCode.endsWith(';')) {
      sourceCode = sourceCode.slice(0, -1);
    }

    return sourceCode;
  }

  const result = babel.transformSync(code, {
    plugins: [plugin],
    parserOpts: {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    },
    generatorOpts: {
      retainLines: false,
      compact: false
    }
  });

  return result?.code || code;
}


/**
 * Options for the transpiler
 */
export type TranspilerOptions = {
  /**
   * Whether to wrap all expressions with ensureSerializable
   * This adds runtime checks but can impact performance
   */
  wrapExpressions?: boolean,
}

/**
 * Wrap all expressions with __STACK_SerializableJs.ensureSerializable
 */
function wrapExpressionsWithEnsureSerializable(code: string): string {
  const plugin: babel.PluginObj = {
    name: 'wrap-expressions-with-ensure-serializable',
    visitor: {
      Expression: {
        exit(path) {
          const { node, parent } = path;

          // Skip if already wrapped
          if (t.isCallExpression(node) &&
              t.isMemberExpression(node.callee) &&
              t.isIdentifier(node.callee.object) &&
              node.callee.object.name === '__STACK_SerializableJs' &&
              t.isIdentifier(node.callee.property) &&
              (node.callee.property.name === 'ensureSerializable' ||
               node.callee.property.name === 'registerFunction' ||
               node.callee.property.name === 'registerClass')) {
            return;
          }

          // Skip if parent is already a wrapper call
          if (t.isCallExpression(parent) &&
              t.isMemberExpression(parent.callee) &&
              t.isIdentifier(parent.callee.object) &&
              parent.callee.object.name === '__STACK_SerializableJs') {
            return;
          }

          // Skip property keys (they can't be wrapped)
          if (t.isObjectProperty(parent) && parent.key === node && !parent.computed) {
            return;
          }
          if (t.isObjectMethod(parent) && parent.key === node && !parent.computed) {
            return;
          }
          if (t.isMemberExpression(parent) && parent.property === node && !parent.computed) {
            return;
          }
          if (t.isClassProperty(parent) && parent.key === node && !parent.computed) {
            return;
          }
          if (t.isClassMethod(parent) && parent.key === node && !parent.computed) {
            return;
          }

          // Skip function and class names
          if (t.isFunctionDeclaration(parent) && parent.id === node) {
            return;
          }
          if (t.isFunctionExpression(parent) && parent.id === node) {
            return;
          }
          if (t.isClassDeclaration(parent) && parent.id === node) {
            return;
          }
          if (t.isClassExpression(parent) && parent.id === node) {
            return;
          }

          // Skip if this is a statement expression (like in ExpressionStatement)
          // We only want to wrap actual expression values, not statement-level expressions
          if (t.isExpressionStatement(parent) && parent.expression === node) {
            return;
          }

          // Skip if this is the argument of an update expression (++, --)
          if (t.isUpdateExpression(parent) && parent.argument === node) {
            return;
          }

          // Skip if this is the left side of an assignment
          if (t.isAssignmentExpression(parent) && parent.left === node) {
            return;
          }

          // Skip if this is a pattern (destructuring)
          if (t.isPattern(node)) {
            return;
          }

          // Don't skip function expressions, arrow functions, or class expressions
          // They should be wrapped with ensureSerializable AND registerFunction/registerClass

          // Wrap the expression
          const wrapped = t.callExpression(
            t.memberExpression(
              t.identifier('__STACK_SerializableJs'),
              t.identifier('ensureSerializable')
            ),
            [node]
          );

          path.replaceWith(wrapped);
          path.skip();
        }
      }
    }
  };

  const result = babel.transformSync(code, {
    plugins: [plugin],
    parserOpts: {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    },
    generatorOpts: {
      retainLines: false,
      compact: false
    }
  });

  return result?.code || code;
}

export function transpileJsToSerializableJs(js: string, options: TranspilerOptions = {}): string {
  // Step 1: Transform async functions and generators to use regenerator runtime
  let transformedCode = transformAsyncAndGenerators(js);

  // Step 2: Bundle runtime helpers and replace imports
  transformedCode = bundleRuntimeHelpers(transformedCode);

  // Step 3: Transform getters/setters to use Object.defineProperty
  transformedCode = transformGettersSetters(transformedCode);

  // Step 4 (Optional): Wrap all expressions with ensureSerializable
  // This happens before wrapping functions so that the wrapped expressions
  // are also captured in the function registrations
  if (options.wrapExpressions) {
    transformedCode = wrapExpressionsWithEnsureSerializable(transformedCode);
  }

  // Step 5: Wrap functions with register functions
  // This happens after bundling so the bundled helpers also get wrapped
  transformedCode = wrapFunctions(transformedCode);

  // Step 6: Prepend custom serialization helpers
  transformedCode = getSerializationHelpers() + "\n\n" + transformedCode;

  return transformedCode;
}
