if(typeof process==="undefined"){globalThis.process={env:{NODE_ENV:"production"}};}
"use strict";
var DashboardUI = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // global-react:react
  var require_react = __commonJS({
    "global-react:react"(exports, module) {
      module.exports = globalThis.React;
    }
  });

  // ../../node_modules/.pnpm/property-expr@2.0.6/node_modules/property-expr/index.js
  var require_property_expr = __commonJS({
    "../../node_modules/.pnpm/property-expr@2.0.6/node_modules/property-expr/index.js"(exports, module) {
      "use strict";
      function Cache(maxSize) {
        this._maxSize = maxSize;
        this.clear();
      }
      Cache.prototype.clear = function() {
        this._size = 0;
        this._values = /* @__PURE__ */ Object.create(null);
      };
      Cache.prototype.get = function(key) {
        return this._values[key];
      };
      Cache.prototype.set = function(key, value) {
        this._size >= this._maxSize && this.clear();
        if (!(key in this._values)) this._size++;
        return this._values[key] = value;
      };
      var SPLIT_REGEX = /[^.^\]^[]+|(?=\[\]|\.\.)/g;
      var DIGIT_REGEX = /^\d+$/;
      var LEAD_DIGIT_REGEX = /^\d/;
      var SPEC_CHAR_REGEX = /[~`!#$%\^&*+=\-\[\]\\';,/{}|\\":<>\?]/g;
      var CLEAN_QUOTES_REGEX = /^\s*(['"]?)(.*?)(\1)\s*$/;
      var MAX_CACHE_SIZE = 512;
      var pathCache = new Cache(MAX_CACHE_SIZE);
      var setCache = new Cache(MAX_CACHE_SIZE);
      var getCache = new Cache(MAX_CACHE_SIZE);
      module.exports = {
        Cache,
        split: split2,
        normalizePath: normalizePath2,
        setter: function(path) {
          var parts = normalizePath2(path);
          return setCache.get(path) || setCache.set(path, function setter(obj, value) {
            var index3 = 0;
            var len = parts.length;
            var data = obj;
            while (index3 < len - 1) {
              var part = parts[index3];
              if (part === "__proto__" || part === "constructor" || part === "prototype") {
                return obj;
              }
              data = data[parts[index3++]];
            }
            data[parts[index3]] = value;
          });
        },
        getter: function(path, safe) {
          var parts = normalizePath2(path);
          return getCache.get(path) || getCache.set(path, function getter2(data) {
            var index3 = 0, len = parts.length;
            while (index3 < len) {
              if (data != null || !safe) data = data[parts[index3++]];
              else return;
            }
            return data;
          });
        },
        join: function(segments) {
          return segments.reduce(function(path, part) {
            return path + (isQuoted(part) || DIGIT_REGEX.test(part) ? "[" + part + "]" : (path ? "." : "") + part);
          }, "");
        },
        forEach: function(path, cb, thisArg) {
          forEach2(Array.isArray(path) ? path : split2(path), cb, thisArg);
        }
      };
      function normalizePath2(path) {
        return pathCache.get(path) || pathCache.set(
          path,
          split2(path).map(function(part) {
            return part.replace(CLEAN_QUOTES_REGEX, "$2");
          })
        );
      }
      function split2(path) {
        return path.match(SPLIT_REGEX) || [""];
      }
      function forEach2(parts, iter, thisArg) {
        var len = parts.length, part, idx, isArray, isBracket;
        for (idx = 0; idx < len; idx++) {
          part = parts[idx];
          if (part) {
            if (shouldBeQuoted(part)) {
              part = '"' + part + '"';
            }
            isBracket = isQuoted(part);
            isArray = !isBracket && /^\d+$/.test(part);
            iter.call(thisArg, part, isBracket, isArray, idx, parts);
          }
        }
      }
      function isQuoted(str) {
        return typeof str === "string" && str && ["'", '"'].indexOf(str.charAt(0)) !== -1;
      }
      function hasLeadingNumber(part) {
        return part.match(LEAD_DIGIT_REGEX) && !part.match(DIGIT_REGEX);
      }
      function hasSpecialChars(part) {
        return SPEC_CHAR_REGEX.test(part);
      }
      function shouldBeQuoted(part) {
        return !isQuoted(part) && (hasLeadingNumber(part) || hasSpecialChars(part));
      }
    }
  });

  // ../../node_modules/.pnpm/tiny-case@1.0.3/node_modules/tiny-case/index.js
  var require_tiny_case = __commonJS({
    "../../node_modules/.pnpm/tiny-case@1.0.3/node_modules/tiny-case/index.js"(exports, module) {
      var reWords = /[A-Z\xc0-\xd6\xd8-\xde]?[a-z\xdf-\xf6\xf8-\xff]+(?:['’](?:d|ll|m|re|s|t|ve))?(?=[\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000]|[A-Z\xc0-\xd6\xd8-\xde]|$)|(?:[A-Z\xc0-\xd6\xd8-\xde]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])+(?:['’](?:D|LL|M|RE|S|T|VE))?(?=[\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000]|[A-Z\xc0-\xd6\xd8-\xde](?:[a-z\xdf-\xf6\xf8-\xff]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])|$)|[A-Z\xc0-\xd6\xd8-\xde]?(?:[a-z\xdf-\xf6\xf8-\xff]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])+(?:['’](?:d|ll|m|re|s|t|ve))?|[A-Z\xc0-\xd6\xd8-\xde]+(?:['’](?:D|LL|M|RE|S|T|VE))?|\d*(?:1ST|2ND|3RD|(?![123])\dTH)(?=\b|[a-z_])|\d*(?:1st|2nd|3rd|(?![123])\dth)(?=\b|[A-Z_])|\d+|(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff])[\ufe0e\ufe0f]?(?:[\u0300-\u036f\ufe20-\ufe2f\u20d0-\u20ff]|\ud83c[\udffb-\udfff])?(?:\u200d(?:[^\ud800-\udfff]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff])[\ufe0e\ufe0f]?(?:[\u0300-\u036f\ufe20-\ufe2f\u20d0-\u20ff]|\ud83c[\udffb-\udfff])?)*/g;
      var words = (str) => str.match(reWords) || [];
      var upperFirst = (str) => str[0].toUpperCase() + str.slice(1);
      var join2 = (str, d) => words(str).join(d).toLowerCase();
      var camelCase2 = (str) => words(str).reduce(
        (acc, next) => `${acc}${!acc ? next.toLowerCase() : next[0].toUpperCase() + next.slice(1).toLowerCase()}`,
        ""
      );
      var pascalCase = (str) => upperFirst(camelCase2(str));
      var snakeCase2 = (str) => join2(str, "_");
      var kebabCase = (str) => join2(str, "-");
      var sentenceCase = (str) => upperFirst(join2(str, " "));
      var titleCase = (str) => words(str).map(upperFirst).join(" ");
      module.exports = {
        words,
        upperFirst,
        camelCase: camelCase2,
        pascalCase,
        snakeCase: snakeCase2,
        kebabCase,
        sentenceCase,
        titleCase
      };
    }
  });

  // ../../node_modules/.pnpm/toposort@2.0.2/node_modules/toposort/index.js
  var require_toposort = __commonJS({
    "../../node_modules/.pnpm/toposort@2.0.2/node_modules/toposort/index.js"(exports, module) {
      module.exports = function(edges) {
        return toposort2(uniqueNodes(edges), edges);
      };
      module.exports.array = toposort2;
      function toposort2(nodes, edges) {
        var cursor = nodes.length, sorted = new Array(cursor), visited = {}, i = cursor, outgoingEdges = makeOutgoingEdges(edges), nodesHash = makeNodesHash(nodes);
        edges.forEach(function(edge) {
          if (!nodesHash.has(edge[0]) || !nodesHash.has(edge[1])) {
            throw new Error("Unknown node. There is an unknown node in the supplied edges.");
          }
        });
        while (i--) {
          if (!visited[i]) visit(nodes[i], i, /* @__PURE__ */ new Set());
        }
        return sorted;
        function visit(node, i2, predecessors) {
          if (predecessors.has(node)) {
            var nodeRep;
            try {
              nodeRep = ", node was:" + JSON.stringify(node);
            } catch (e15) {
              nodeRep = "";
            }
            throw new Error("Cyclic dependency" + nodeRep);
          }
          if (!nodesHash.has(node)) {
            throw new Error("Found unknown node. Make sure to provided all involved nodes. Unknown node: " + JSON.stringify(node));
          }
          if (visited[i2]) return;
          visited[i2] = true;
          var outgoing = outgoingEdges.get(node) || /* @__PURE__ */ new Set();
          outgoing = Array.from(outgoing);
          if (i2 = outgoing.length) {
            predecessors.add(node);
            do {
              var child = outgoing[--i2];
              visit(child, nodesHash.get(child), predecessors);
            } while (i2);
            predecessors.delete(node);
          }
          sorted[--cursor] = node;
        }
      }
      function uniqueNodes(arr) {
        var res = /* @__PURE__ */ new Set();
        for (var i = 0, len = arr.length; i < len; i++) {
          var edge = arr[i];
          res.add(edge[0]);
          res.add(edge[1]);
        }
        return Array.from(res);
      }
      function makeOutgoingEdges(arr) {
        var edges = /* @__PURE__ */ new Map();
        for (var i = 0, len = arr.length; i < len; i++) {
          var edge = arr[i];
          if (!edges.has(edge[0])) edges.set(edge[0], /* @__PURE__ */ new Set());
          if (!edges.has(edge[1])) edges.set(edge[1], /* @__PURE__ */ new Set());
          edges.get(edge[0]).add(edge[1]);
        }
        return edges;
      }
      function makeNodesHash(arr) {
        var res = /* @__PURE__ */ new Map();
        for (var i = 0, len = arr.length; i < len; i++) {
          res.set(arr[i], i);
        }
        return res;
      }
    }
  });

  // global-react-dom:react-dom
  var require_react_dom = __commonJS({
    "global-react-dom:react-dom"(exports, module) {
      module.exports = globalThis.ReactDOM;
    }
  });

  // global-recharts:recharts
  var require_recharts = __commonJS({
    "global-recharts:recharts"(exports, module) {
      module.exports = globalThis.Recharts;
    }
  });

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    CursorBlastEffect: () => CursorBlastEffect,
    DESIGN_CHART_AXIS_TICK_STYLE: () => DESIGN_CHART_AXIS_TICK_STYLE,
    DESIGN_CHART_COLORS: () => DESIGN_CHART_COLORS,
    DESIGN_CHART_GRID_COLOR: () => DESIGN_CHART_GRID_COLOR,
    DesignAlert: () => DesignAlert,
    DesignBadge: () => DesignBadge,
    DesignButton: () => DesignButton,
    DesignCard: () => DesignCard,
    DesignCardTint: () => DesignCardTint,
    DesignCategoryTabs: () => DesignCategoryTabs,
    DesignChartCard: () => DesignChartCard,
    DesignChartContainer: () => DesignChartContainer,
    DesignChartLegend: () => DesignChartLegend,
    DesignChartLegendContent: () => DesignChartLegendContent,
    DesignChartStyle: () => DesignChartStyle,
    DesignChartTooltip: () => DesignChartTooltip,
    DesignChartTooltipContent: () => DesignChartTooltipContent,
    DesignEditMode: () => DesignEditMode,
    DesignEmptyState: () => DesignEmptyState,
    DesignInput: () => DesignInput,
    DesignMetricCard: () => DesignMetricCard,
    DesignPillToggle: () => DesignPillToggle,
    DesignProgressBar: () => DesignProgressBar,
    DesignSeparator: () => DesignSeparator,
    DesignSkeleton: () => DesignSkeleton,
    DesignTable: () => DesignTable,
    DesignTableBody: () => DesignTableBody,
    DesignTableCell: () => DesignTableCell,
    DesignTableHead: () => DesignTableHead,
    DesignTableHeader: () => DesignTableHeader,
    DesignTableRow: () => DesignTableRow,
    Draggable: () => Draggable,
    ElementSlot: () => ElementSlot,
    ResizeHandle: () => ResizeHandle,
    SwappableWidgetInstanceGrid: () => SwappableWidgetInstanceGrid,
    SwappableWidgetInstanceGridContext: () => SwappableWidgetInstanceGridContext,
    VarHeightSlot: () => VarHeightSlot,
    WidgetInstanceGrid: () => WidgetInstanceGrid,
    createErrorWidget: () => createErrorWidget,
    createSectionHeadingInstance: () => createSectionHeadingInstance,
    createWidgetInstance: () => createWidgetInstance,
    deserializeWidgetInstance: () => deserializeWidgetInstance,
    getDesignChartColor: () => getDesignChartColor,
    getPayloadConfigFromPayload: () => getPayloadConfigFromPayload,
    getSettings: () => getSettings,
    getState: () => getState2,
    gridGapPixels: () => gridGapPixels,
    gridUnitHeight: () => gridUnitHeight,
    mapRefState: () => mapRefState,
    mobileModeCutoffWidth: () => mobileModeCutoffWidth,
    mobileModeWidgetHeight: () => mobileModeWidgetHeight,
    sectionHeadingWidget: () => sectionHeadingWidget,
    serializeWidgetInstance: () => serializeWidgetInstance,
    useDesignChart: () => useDesignChart,
    useDesignEditMode: () => useDesignEditMode,
    useGlassmorphicDefault: () => useGlassmorphicDefault,
    useInsideDesignCard: () => useInsideDesignCard,
    useRefState: () => useRefState
  });

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/defs/CheckCircle.es.js
  var e = __toESM(require_react(), 1);
  var a = /* @__PURE__ */ new Map([
    [
      "bold",
      /* @__PURE__ */ e.createElement(e.Fragment, null, /* @__PURE__ */ e.createElement("path", { d: "M176.49,95.51a12,12,0,0,1,0,17l-56,56a12,12,0,0,1-17,0l-24-24a12,12,0,1,1,17-17L112,143l47.51-47.52A12,12,0,0,1,176.49,95.51ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Z" }))
    ],
    [
      "duotone",
      /* @__PURE__ */ e.createElement(e.Fragment, null, /* @__PURE__ */ e.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ e.createElement("path", { d: "M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" }))
    ],
    [
      "fill",
      /* @__PURE__ */ e.createElement(e.Fragment, null, /* @__PURE__ */ e.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z" }))
    ],
    [
      "light",
      /* @__PURE__ */ e.createElement(e.Fragment, null, /* @__PURE__ */ e.createElement("path", { d: "M172.24,99.76a6,6,0,0,1,0,8.48l-56,56a6,6,0,0,1-8.48,0l-24-24a6,6,0,0,1,8.48-8.48L112,151.51l51.76-51.75A6,6,0,0,1,172.24,99.76ZM230,128A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z" }))
    ],
    [
      "regular",
      /* @__PURE__ */ e.createElement(e.Fragment, null, /* @__PURE__ */ e.createElement("path", { d: "M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" }))
    ],
    [
      "thin",
      /* @__PURE__ */ e.createElement(e.Fragment, null, /* @__PURE__ */ e.createElement("path", { d: "M170.83,101.17a4,4,0,0,1,0,5.66l-56,56a4,4,0,0,1-5.66,0l-24-24a4,4,0,0,1,5.66-5.66L112,154.34l53.17-53.17A4,4,0,0,1,170.83,101.17ZM228,128A100,100,0,1,1,128,28,100.11,100.11,0,0,1,228,128Zm-8,0a92,92,0,1,0-92,92A92.1,92.1,0,0,0,220,128Z" }))
    ]
  ]);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/defs/GridFour.es.js
  var e2 = __toESM(require_react(), 1);
  var a2 = /* @__PURE__ */ new Map([
    [
      "bold",
      /* @__PURE__ */ e2.createElement(e2.Fragment, null, /* @__PURE__ */ e2.createElement("path", { d: "M200,36H56A20,20,0,0,0,36,56V200a20,20,0,0,0,20,20H200a20,20,0,0,0,20-20V56A20,20,0,0,0,200,36Zm-4,80H140V60h56ZM116,60v56H60V60ZM60,140h56v56H60Zm80,56V140h56v56Z" }))
    ],
    [
      "duotone",
      /* @__PURE__ */ e2.createElement(e2.Fragment, null, /* @__PURE__ */ e2.createElement(
        "path",
        {
          d: "M208,56V200a8,8,0,0,1-8,8H56a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H200A8,8,0,0,1,208,56Z",
          opacity: "0.2"
        }
      ), /* @__PURE__ */ e2.createElement("path", { d: "M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,80H136V56h64ZM120,56v64H56V56ZM56,136h64v64H56Zm144,64H136V136h64v64Z" }))
    ],
    [
      "fill",
      /* @__PURE__ */ e2.createElement(e2.Fragment, null, /* @__PURE__ */ e2.createElement("path", { d: "M216,56v60a4,4,0,0,1-4,4H136V44a4,4,0,0,1,4-4h60A16,16,0,0,1,216,56ZM116,40H56A16,16,0,0,0,40,56v60a4,4,0,0,0,4,4h76V44A4,4,0,0,0,116,40Zm96,96H136v76a4,4,0,0,0,4,4h60a16,16,0,0,0,16-16V140A4,4,0,0,0,212,136ZM40,140v60a16,16,0,0,0,16,16h60a4,4,0,0,0,4-4V136H44A4,4,0,0,0,40,140Z" }))
    ],
    [
      "light",
      /* @__PURE__ */ e2.createElement(e2.Fragment, null, /* @__PURE__ */ e2.createElement("path", { d: "M200,42H56A14,14,0,0,0,42,56V200a14,14,0,0,0,14,14H200a14,14,0,0,0,14-14V56A14,14,0,0,0,200,42Zm2,14v66H134V54h66A2,2,0,0,1,202,56ZM56,54h66v68H54V56A2,2,0,0,1,56,54ZM54,200V134h68v68H56A2,2,0,0,1,54,200Zm146,2H134V134h68v66A2,2,0,0,1,200,202Z" }))
    ],
    [
      "regular",
      /* @__PURE__ */ e2.createElement(e2.Fragment, null, /* @__PURE__ */ e2.createElement("path", { d: "M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,80H136V56h64ZM120,56v64H56V56ZM56,136h64v64H56Zm144,64H136V136h64v64Z" }))
    ],
    [
      "thin",
      /* @__PURE__ */ e2.createElement(e2.Fragment, null, /* @__PURE__ */ e2.createElement("path", { d: "M200,44H56A12,12,0,0,0,44,56V200a12,12,0,0,0,12,12H200a12,12,0,0,0,12-12V56A12,12,0,0,0,200,44Zm4,12v68H132V52h68A4,4,0,0,1,204,56ZM56,52h68v72H52V56A4,4,0,0,1,56,52ZM52,200V132h72v72H56A4,4,0,0,1,52,200Zm148,4H132V132h72v68A4,4,0,0,1,200,204Z" }))
    ]
  ]);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/defs/Info.es.js
  var e3 = __toESM(require_react(), 1);
  var a3 = /* @__PURE__ */ new Map([
    [
      "bold",
      /* @__PURE__ */ e3.createElement(e3.Fragment, null, /* @__PURE__ */ e3.createElement("path", { d: "M108,84a16,16,0,1,1,16,16A16,16,0,0,1,108,84Zm128,44A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Zm-72,36.68V132a20,20,0,0,0-20-20,12,12,0,0,0-4,23.32V168a20,20,0,0,0,20,20,12,12,0,0,0,4-23.32Z" }))
    ],
    [
      "duotone",
      /* @__PURE__ */ e3.createElement(e3.Fragment, null, /* @__PURE__ */ e3.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ e3.createElement("path", { d: "M144,176a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176Zm88-48A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128ZM124,96a12,12,0,1,0-12-12A12,12,0,0,0,124,96Z" }))
    ],
    [
      "fill",
      /* @__PURE__ */ e3.createElement(e3.Fragment, null, /* @__PURE__ */ e3.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z" }))
    ],
    [
      "light",
      /* @__PURE__ */ e3.createElement(e3.Fragment, null, /* @__PURE__ */ e3.createElement("path", { d: "M142,176a6,6,0,0,1-6,6,14,14,0,0,1-14-14V128a2,2,0,0,0-2-2,6,6,0,0,1,0-12,14,14,0,0,1,14,14v40a2,2,0,0,0,2,2A6,6,0,0,1,142,176ZM124,94a10,10,0,1,0-10-10A10,10,0,0,0,124,94Zm106,34A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z" }))
    ],
    [
      "regular",
      /* @__PURE__ */ e3.createElement(e3.Fragment, null, /* @__PURE__ */ e3.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z" }))
    ],
    [
      "thin",
      /* @__PURE__ */ e3.createElement(e3.Fragment, null, /* @__PURE__ */ e3.createElement("path", { d: "M140,176a4,4,0,0,1-4,4,12,12,0,0,1-12-12V128a4,4,0,0,0-4-4,4,4,0,0,1,0-8,12,12,0,0,1,12,12v40a4,4,0,0,0,4,4A4,4,0,0,1,140,176ZM124,92a8,8,0,1,0-8-8A8,8,0,0,0,124,92Zm104,36A100,100,0,1,1,128,28,100.11,100.11,0,0,1,228,128Zm-8,0a92,92,0,1,0-92,92A92.1,92.1,0,0,0,220,128Z" }))
    ]
  ]);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/defs/Plus.es.js
  var e4 = __toESM(require_react(), 1);
  var a4 = /* @__PURE__ */ new Map([
    [
      "bold",
      /* @__PURE__ */ e4.createElement(e4.Fragment, null, /* @__PURE__ */ e4.createElement("path", { d: "M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z" }))
    ],
    [
      "duotone",
      /* @__PURE__ */ e4.createElement(e4.Fragment, null, /* @__PURE__ */ e4.createElement(
        "path",
        {
          d: "M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z",
          opacity: "0.2"
        }
      ), /* @__PURE__ */ e4.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" }))
    ],
    [
      "fill",
      /* @__PURE__ */ e4.createElement(e4.Fragment, null, /* @__PURE__ */ e4.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM184,136H136v48a8,8,0,0,1-16,0V136H72a8,8,0,0,1,0-16h48V72a8,8,0,0,1,16,0v48h48a8,8,0,0,1,0,16Z" }))
    ],
    [
      "light",
      /* @__PURE__ */ e4.createElement(e4.Fragment, null, /* @__PURE__ */ e4.createElement("path", { d: "M222,128a6,6,0,0,1-6,6H134v82a6,6,0,0,1-12,0V134H40a6,6,0,0,1,0-12h82V40a6,6,0,0,1,12,0v82h82A6,6,0,0,1,222,128Z" }))
    ],
    [
      "regular",
      /* @__PURE__ */ e4.createElement(e4.Fragment, null, /* @__PURE__ */ e4.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" }))
    ],
    [
      "thin",
      /* @__PURE__ */ e4.createElement(e4.Fragment, null, /* @__PURE__ */ e4.createElement("path", { d: "M220,128a4,4,0,0,1-4,4H132v84a4,4,0,0,1-8,0V132H40a4,4,0,0,1,0-8h84V40a4,4,0,0,1,8,0v84h84A4,4,0,0,1,220,128Z" }))
    ]
  ]);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/defs/WarningCircle.es.js
  var e5 = __toESM(require_react(), 1);
  var a5 = /* @__PURE__ */ new Map([
    [
      "bold",
      /* @__PURE__ */ e5.createElement(e5.Fragment, null, /* @__PURE__ */ e5.createElement("path", { d: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm-12-80V80a12,12,0,0,1,24,0v52a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,172Z" }))
    ],
    [
      "duotone",
      /* @__PURE__ */ e5.createElement(e5.Fragment, null, /* @__PURE__ */ e5.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ e5.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z" }))
    ],
    [
      "fill",
      /* @__PURE__ */ e5.createElement(e5.Fragment, null, /* @__PURE__ */ e5.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z" }))
    ],
    [
      "light",
      /* @__PURE__ */ e5.createElement(e5.Fragment, null, /* @__PURE__ */ e5.createElement("path", { d: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Zm-6-82V80a6,6,0,0,1,12,0v56a6,6,0,0,1-12,0Zm16,36a10,10,0,1,1-10-10A10,10,0,0,1,138,172Z" }))
    ],
    [
      "regular",
      /* @__PURE__ */ e5.createElement(e5.Fragment, null, /* @__PURE__ */ e5.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z" }))
    ],
    [
      "thin",
      /* @__PURE__ */ e5.createElement(e5.Fragment, null, /* @__PURE__ */ e5.createElement("path", { d: "M128,28A100,100,0,1,0,228,128,100.11,100.11,0,0,0,128,28Zm0,192a92,92,0,1,1,92-92A92.1,92.1,0,0,1,128,220Zm-4-84V80a4,4,0,0,1,8,0v56a4,4,0,0,1-8,0Zm12,36a8,8,0,1,1-8-8A8,8,0,0,1,136,172Z" }))
    ]
  ]);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/defs/X.es.js
  var e6 = __toESM(require_react(), 1);
  var a6 = /* @__PURE__ */ new Map([
    [
      "bold",
      /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z" }))
    ],
    [
      "duotone",
      /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement(
        "path",
        {
          d: "M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z",
          opacity: "0.2"
        }
      ), /* @__PURE__ */ e6.createElement("path", { d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))
    ],
    [
      "fill",
      /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM181.66,170.34a8,8,0,0,1-11.32,11.32L128,139.31,85.66,181.66a8,8,0,0,1-11.32-11.32L116.69,128,74.34,85.66A8,8,0,0,1,85.66,74.34L128,116.69l42.34-42.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))
    ],
    [
      "light",
      /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z" }))
    ],
    [
      "regular",
      /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))
    ],
    [
      "thin",
      /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M202.83,197.17a4,4,0,0,1-5.66,5.66L128,133.66,58.83,202.83a4,4,0,0,1-5.66-5.66L122.34,128,53.17,58.83a4,4,0,0,1,5.66-5.66L128,122.34l69.17-69.17a4,4,0,1,1,5.66,5.66L133.66,128Z" }))
    ]
  ]);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/defs/XCircle.es.js
  var e7 = __toESM(require_react(), 1);
  var a7 = /* @__PURE__ */ new Map([
    [
      "bold",
      /* @__PURE__ */ e7.createElement(e7.Fragment, null, /* @__PURE__ */ e7.createElement("path", { d: "M168.49,104.49,145,128l23.52,23.51a12,12,0,0,1-17,17L128,145l-23.51,23.52a12,12,0,0,1-17-17L111,128,87.51,104.49a12,12,0,0,1,17-17L128,111l23.51-23.52a12,12,0,0,1,17,17ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Z" }))
    ],
    [
      "duotone",
      /* @__PURE__ */ e7.createElement(e7.Fragment, null, /* @__PURE__ */ e7.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ e7.createElement("path", { d: "M165.66,101.66,139.31,128l26.35,26.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" }))
    ],
    [
      "fill",
      /* @__PURE__ */ e7.createElement(e7.Fragment, null, /* @__PURE__ */ e7.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))
    ],
    [
      "light",
      /* @__PURE__ */ e7.createElement(e7.Fragment, null, /* @__PURE__ */ e7.createElement("path", { d: "M164.24,100.24,136.48,128l27.76,27.76a6,6,0,1,1-8.48,8.48L128,136.48l-27.76,27.76a6,6,0,0,1-8.48-8.48L119.52,128,91.76,100.24a6,6,0,0,1,8.48-8.48L128,119.52l27.76-27.76a6,6,0,0,1,8.48,8.48ZM230,128A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z" }))
    ],
    [
      "regular",
      /* @__PURE__ */ e7.createElement(e7.Fragment, null, /* @__PURE__ */ e7.createElement("path", { d: "M165.66,101.66,139.31,128l26.35,26.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" }))
    ],
    [
      "thin",
      /* @__PURE__ */ e7.createElement(e7.Fragment, null, /* @__PURE__ */ e7.createElement("path", { d: "M162.83,98.83,133.66,128l29.17,29.17a4,4,0,0,1-5.66,5.66L128,133.66,98.83,162.83a4,4,0,0,1-5.66-5.66L122.34,128,93.17,98.83a4,4,0,0,1,5.66-5.66L128,122.34l29.17-29.17a4,4,0,1,1,5.66,5.66ZM228,128A100,100,0,1,1,128,28,100.11,100.11,0,0,1,228,128Zm-8,0a92,92,0,1,0-92,92A92.1,92.1,0,0,0,220,128Z" }))
    ]
  ]);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/lib/IconBase.es.js
  var e8 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/lib/context.es.js
  var import_react = __toESM(require_react(), 1);
  var o = (0, import_react.createContext)({
    color: "currentColor",
    size: "1em",
    weight: "regular",
    mirrored: false
  });

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/lib/IconBase.es.js
  var p = e8.forwardRef(
    (s4, a8) => {
      const {
        alt: n3,
        color: r5,
        size: t,
        weight: o7,
        mirrored: c3,
        children: i,
        weights: m2,
        ...x
      } = s4, {
        color: d = "currentColor",
        size: l,
        weight: f = "regular",
        mirrored: g = false,
        ...w
      } = e8.useContext(o);
      return /* @__PURE__ */ e8.createElement(
        "svg",
        {
          ref: a8,
          xmlns: "http://www.w3.org/2000/svg",
          width: t != null ? t : l,
          height: t != null ? t : l,
          fill: r5 != null ? r5 : d,
          viewBox: "0 0 256 256",
          transform: c3 || g ? "scale(-1, 1)" : void 0,
          ...w,
          ...x
        },
        !!n3 && /* @__PURE__ */ e8.createElement("title", null, n3),
        i,
        m2.get(o7 != null ? o7 : f)
      );
    }
  );
  p.displayName = "IconBase";

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/csr/CheckCircle.es.js
  var e9 = __toESM(require_react(), 1);
  var c = e9.forwardRef((o7, r5) => /* @__PURE__ */ e9.createElement(p, { ref: r5, ...o7, weights: a }));
  c.displayName = "CheckCircleIcon";
  var s = c;

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/csr/GridFour.es.js
  var o2 = __toESM(require_react(), 1);
  var r2 = o2.forwardRef((e15, t) => /* @__PURE__ */ o2.createElement(p, { ref: t, ...e15, weights: a2 }));
  r2.displayName = "GridFourIcon";
  var s2 = r2;

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/csr/Info.es.js
  var o3 = __toESM(require_react(), 1);
  var e10 = o3.forwardRef((r5, t) => /* @__PURE__ */ o3.createElement(p, { ref: t, ...r5, weights: a3 }));
  e10.displayName = "InfoIcon";
  var c2 = e10;

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/csr/Plus.es.js
  var o4 = __toESM(require_react(), 1);
  var e11 = o4.forwardRef((r5, s4) => /* @__PURE__ */ o4.createElement(p, { ref: s4, ...r5, weights: a4 }));
  e11.displayName = "PlusIcon";
  var n = e11;

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/csr/WarningCircle.es.js
  var r3 = __toESM(require_react(), 1);
  var e12 = r3.forwardRef((o7, n3) => /* @__PURE__ */ r3.createElement(p, { ref: n3, ...o7, weights: a5 }));
  e12.displayName = "WarningCircleIcon";
  var m = e12;

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/csr/X.es.js
  var o5 = __toESM(require_react(), 1);
  var e13 = o5.forwardRef((r5, t) => /* @__PURE__ */ o5.createElement(p, { ref: t, ...r5, weights: a6 }));
  e13.displayName = "XIcon";
  var n2 = e13;

  // ../../node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@phosphor-icons/react/dist/csr/XCircle.es.js
  var e14 = __toESM(require_react(), 1);
  var o6 = e14.forwardRef((r5, c3) => /* @__PURE__ */ e14.createElement(p, { ref: c3, ...r5, weights: a7 }));
  o6.displayName = "XCircleIcon";
  var s3 = o6;

  // jsx-shim:react/jsx-runtime
  var import_react2 = __toESM(require_react());
  function jsx(type, props, key) {
    return import_react2.default.createElement(type, key !== void 0 ? Object.assign({}, props, { key }) : props);
  }
  function jsxs(type, props, key) {
    return import_react2.default.createElement(type, key !== void 0 ? Object.assign({}, props, { key }) : props);
  }
  var Fragment8 = import_react2.default.Fragment;

  // ../stack-shared/dist/esm/utils/arrays.js
  function findLastIndex(arr, predicate) {
    for (let i = arr.length - 1; i >= 0; i--) if (predicate(arr[i])) return i;
    return -1;
  }
  function range(startInclusive, endExclusive, step) {
    if (endExclusive === void 0) {
      endExclusive = startInclusive;
      startInclusive = 0;
    }
    if (step === void 0) step = 1;
    const result = [];
    for (let i = startInclusive; step > 0 ? i < endExclusive : i > endExclusive; i += step) result.push(i);
    return result;
  }
  function unique(arr) {
    return [...new Set(arr)];
  }

  // ../stack-shared/dist/esm/utils/strings.js
  function stringCompare(a8, b) {
    if (typeof a8 !== "string" || typeof b !== "string") throw new StackAssertionError(`Expected two strings for stringCompare, found ${typeof a8} and ${typeof b}`, {
      a: a8,
      b
    });
    const cmp = (a9, b2) => a9 < b2 ? -1 : a9 > b2 ? 1 : 0;
    return cmp(a8.toUpperCase(), b.toUpperCase()) || cmp(b, a8);
  }
  function getWhitespacePrefix(s4) {
    return s4.substring(0, s4.length - s4.trimStart().length);
  }
  function trimEmptyLinesStart(s4) {
    const lines = s4.split("\n");
    const firstNonEmptyLineIndex = lines.findIndex((line) => line.trim() !== "");
    if (firstNonEmptyLineIndex === -1) return "";
    return lines.slice(firstNonEmptyLineIndex).join("\n");
  }
  function trimEmptyLinesEnd(s4) {
    const lines = s4.split("\n");
    const lastNonEmptyLineIndex = findLastIndex(lines, (line) => line.trim() !== "");
    return lines.slice(0, lastNonEmptyLineIndex + 1).join("\n");
  }
  function templateIdentity(strings, ...values) {
    if (values.length !== strings.length - 1) throw new StackAssertionError("Invalid number of values; must be one less than strings", {
      strings,
      values
    });
    return strings.reduce((result, str, i) => result + str + (values[i] ?? ""), "");
  }
  function deindent(strings, ...values) {
    if (typeof strings === "string") return deindent([strings]);
    return templateIdentity(...deindentTemplate(strings, ...values));
  }
  function deindentTemplate(strings, ...values) {
    if (values.length !== strings.length - 1) throw new StackAssertionError("Invalid number of values; must be one less than strings", {
      strings,
      values
    });
    const trimmedStrings = [...strings];
    trimmedStrings[0] = trimEmptyLinesStart(trimmedStrings[0] + "+").slice(0, -1);
    trimmedStrings[trimmedStrings.length - 1] = trimEmptyLinesEnd("+" + trimmedStrings[trimmedStrings.length - 1]).slice(1);
    const indentation = trimmedStrings.join("${SOME_VALUE}").split("\n").filter((line) => line.trim() !== "").map((line) => getWhitespacePrefix(line).length).reduce((min2, current) => Math.min(min2, current), Infinity);
    const deindentedStrings = trimmedStrings.map((string2, stringIndex) => {
      return string2.split("\n").map((line, lineIndex) => stringIndex !== 0 && lineIndex === 0 ? line : line.substring(indentation)).join("\n");
    });
    return [deindentedStrings, ...values.map((value, i) => {
      const firstLineIndentation = getWhitespacePrefix(deindentedStrings[i].split("\n").at(-1));
      return `${value}`.replaceAll("\n", `
${firstLineIndentation}`);
    })];
  }
  function escapeTemplateLiteral(s4) {
    return s4.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
  }
  var nicifiableClassNameOverrides = new Map(Object.entries({ Headers }).map(([k, v]) => [v, k]));
  function nicify(value, options = {}) {
    const fullOptions = {
      maxDepth: 5,
      currentIndent: "",
      lineIndent: "  ",
      multiline: true,
      refs: /* @__PURE__ */ new Map(),
      path: "value",
      parent: null,
      overrides: () => null,
      keyInParent: null,
      hideFields: [],
      ...filterUndefined(options)
    };
    const { maxDepth, currentIndent, lineIndent, multiline, refs, path, overrides, hideFields } = fullOptions;
    const nl = `
${currentIndent}`;
    const overrideResult = overrides(value, options);
    if (overrideResult !== null) return overrideResult;
    if ([
      "function",
      "object",
      "symbol"
    ].includes(typeof value) && value !== null) {
      if (refs.has(value)) return `Ref<${refs.get(value)}>`;
      refs.set(value, path);
    }
    const newOptions = {
      maxDepth: maxDepth - 1,
      currentIndent,
      lineIndent,
      multiline,
      refs,
      path: path + "->[unknown property]",
      overrides,
      parent: {
        value,
        options: fullOptions
      },
      keyInParent: null,
      hideFields: []
    };
    const nestedNicify = (newValue, newPath, keyInParent, options2 = {}) => {
      return nicify(newValue, {
        ...newOptions,
        path: newPath,
        currentIndent: currentIndent + lineIndent,
        keyInParent,
        ...options2
      });
    };
    switch (typeof value) {
      case "boolean":
      case "number":
        return JSON.stringify(value);
      case "string": {
        const isDeindentable = (v) => deindent(v) === v && v.includes("\n");
        const wrapInDeindent = (v) => deindent`
        deindent\`
        ${currentIndent + lineIndent}${escapeTemplateLiteral(v).replaceAll("\n", nl + lineIndent)}
        ${currentIndent}\`
      `;
        if (isDeindentable(value)) return wrapInDeindent(value);
        else if (value.endsWith("\n") && isDeindentable(value.slice(0, -1))) return wrapInDeindent(value.slice(0, -1)) + ' + "\\n"';
        else return JSON.stringify(value);
      }
      case "undefined":
        return "undefined";
      case "symbol":
        return value.toString();
      case "bigint":
        return `${value}n`;
      case "function":
        if (value.name) return `function ${value.name}(...) { ... }`;
        return `(...) => { ... }`;
      case "object": {
        if (value === null) return "null";
        if (Array.isArray(value)) {
          const extraLines2 = getNicifiedObjectExtraLines(value);
          const resValueLength2 = value.length + extraLines2.length;
          if (resValueLength2 === 0) return "[]";
          if (maxDepth <= 0) return `[...]`;
          const resValues2 = value.map((v, i) => nestedNicify(v, `${path}[${i}]`, i));
          resValues2.push(...extraLines2);
          if (resValues2.length !== resValueLength2) throw new StackAssertionError("nicify of object: resValues.length !== resValueLength", {
            value,
            resValues: resValues2,
            resValueLength: resValueLength2
          });
          if (resValues2.length > 4 || resValues2.some((x) => resValues2.length > 1 && x.length > 4 || x.includes("\n"))) return `[${nl}${resValues2.map((x) => `${lineIndent}${x},${nl}`).join("")}]`;
          else return `[${resValues2.join(", ")}]`;
        }
        if (value instanceof Date) return `Date(${nestedNicify(value.toISOString(), `${path}.toISOString()`, null)})`;
        if (value instanceof URL) return `URL(${nestedNicify(value.toString(), `${path}.toString()`, null)})`;
        if (ArrayBuffer.isView(value)) return `${value.constructor.name}([${value.toString()}])`;
        if (value instanceof ArrayBuffer) return `ArrayBuffer [${new Uint8Array(value).toString()}]`;
        if (value instanceof Error) {
          let stack = value.stack ?? "";
          const toString2 = value.toString();
          if (!stack.startsWith(toString2)) stack = `${toString2}
${stack}`;
          stack = stack.trimEnd();
          stack = stack.replace(/\n\s+/g, `
${lineIndent}${lineIndent}`);
          stack = stack.replace("\n", `
${lineIndent}Stack:
`);
          if (Object.keys(value).length > 0) stack += `
${lineIndent}Extra properties: ${nestedNicify(Object.fromEntries(Object.entries(value)), path, null)}`;
          if (value.cause) stack += `
${lineIndent}Cause:
${lineIndent}${lineIndent}${nestedNicify(value.cause, path, null, { currentIndent: currentIndent + lineIndent + lineIndent })}`;
          stack = stack.replaceAll("\n", `
${currentIndent}`);
          return stack;
        }
        const constructorName = [null, Object.prototype].includes(Object.getPrototypeOf(value)) ? null : nicifiableClassNameOverrides.get(value.constructor) ?? value.constructor.name;
        const constructorString = constructorName ? `${constructorName} ` : "";
        const entries = getNicifiableEntries(value).filter(([k]) => !hideFields.includes(k));
        const extraLines = [...getNicifiedObjectExtraLines(value), ...hideFields.length > 0 ? [`<some fields may have been hidden>`] : []];
        const resValueLength = entries.length + extraLines.length;
        if (resValueLength === 0) return `${constructorString}{}`;
        if (maxDepth <= 0) return `${constructorString}{ ... }`;
        const resValues = entries.map(([k, v], keyIndex) => {
          const keyNicified = nestedNicify(k, `Object.keys(${path})[${keyIndex}]`, null);
          const keyInObjectLiteral = typeof k === "string" ? nicifyPropertyString(k) : `[${keyNicified}]`;
          if (typeof v === "function" && v.name === k) return `${keyInObjectLiteral}(...): { ... }`;
          else return `${keyInObjectLiteral}: ${nestedNicify(v, `${path}[${keyNicified}]`, k)}`;
        });
        resValues.push(...extraLines);
        if (resValues.length !== resValueLength) throw new StackAssertionError("nicify of object: resValues.length !== resValueLength", {
          value,
          resValues,
          resValueLength
        });
        const shouldIndent = resValues.length > 1 || resValues.some((x) => x.includes("\n"));
        if (resValues.length === 0) return `${constructorString}{}`;
        if (shouldIndent) return `${constructorString}{${nl}${resValues.map((x) => `${lineIndent}${x},${nl}`).join("")}}`;
        else return `${constructorString}{ ${resValues.join(", ")} }`;
      }
      default:
        return `${typeof value}<${value}>`;
    }
  }
  function nicifyPropertyString(str) {
    return JSON.stringify(str);
  }
  function getNicifiableKeys(value) {
    const overridden = ("getNicifiableKeys" in value ? value.getNicifiableKeys?.bind(value) : null)?.();
    if (overridden != null) return overridden;
    if (value instanceof Response) return ["status", "headers"];
    return unique(Object.keys(value).sort());
  }
  function getNicifiableEntries(value) {
    const recordLikes = [Headers];
    function isRecordLike(value2) {
      return recordLikes.some((x) => value2 instanceof x);
    }
    if (isRecordLike(value)) return [...value.entries()].sort(([a8], [b]) => stringCompare(`${a8}`, `${b}`));
    return getNicifiableKeys(value).map((k) => [k, value[k]]);
  }
  function getNicifiedObjectExtraLines(value) {
    return ("getNicifiedObjectExtraLines" in value ? value.getNicifiedObjectExtraLines : null)?.() ?? [];
  }

  // ../stack-shared/dist/esm/utils/functions.js
  function identityArgs(...args) {
    return args;
  }

  // ../stack-shared/dist/esm/utils/types.js
  typeAssertIs()();
  typeAssertIs()();
  typeAssertIs()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  function typeAssertExtends() {
    return () => void 0;
  }
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  function typeAssertIs() {
    return () => void 0;
  }
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();
  typeAssertExtends()();

  // ../stack-shared/dist/esm/utils/objects.js
  function isNotNull(value) {
    return value !== null && value !== void 0;
  }
  function deepPlainEquals(obj1, obj2, options = {}) {
    if (typeof obj1 !== typeof obj2) return false;
    if (obj1 === obj2) return true;
    switch (typeof obj1) {
      case "object": {
        if (!obj1 || !obj2) return false;
        if (Array.isArray(obj1) || Array.isArray(obj2)) {
          if (!Array.isArray(obj1) || !Array.isArray(obj2)) return false;
          if (obj1.length !== obj2.length) return false;
          return obj1.every((v, i) => deepPlainEquals(v, obj2[i], options));
        }
        const entries1 = Object.entries(obj1).filter(([k, v]) => !options.ignoreUndefinedValues || v !== void 0);
        const entries2 = Object.entries(obj2).filter(([k, v]) => !options.ignoreUndefinedValues || v !== void 0);
        if (entries1.length !== entries2.length) return false;
        return entries1.every(([k, v1]) => {
          const e22 = entries2.find(([k2]) => k === k2);
          if (!e22) return false;
          return deepPlainEquals(v1, e22[1], options);
        });
      }
      case "undefined":
      case "string":
      case "number":
      case "boolean":
      case "bigint":
      case "symbol":
      case "function":
        return false;
      default:
        throw new Error("Unexpected typeof " + typeof obj1);
    }
  }
  function deepPlainClone(obj) {
    if (typeof obj === "function") throw new StackAssertionError("deepPlainClone does not support functions");
    if (typeof obj === "symbol") throw new StackAssertionError("deepPlainClone does not support symbols");
    if (typeof obj !== "object" || !obj) return obj;
    if (Array.isArray(obj)) return obj.map(deepPlainClone);
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deepPlainClone(v)]));
  }
  function typedFromEntries(entries) {
    return Object.fromEntries(entries);
  }
  function filterUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== void 0));
  }
  typeAssertIs()();
  function pick(obj, keys) {
    return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
  }
  function omit(obj, keys) {
    if (!Array.isArray(keys)) throw new StackAssertionError("omit: keys must be an array", {
      obj,
      keys
    });
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
  }

  // ../stack-shared/dist/esm/utils/globals.js
  var globalVar = typeof globalThis !== "undefined" ? globalThis : typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {};
  if (typeof globalThis === "undefined") globalVar.globalThis = globalVar;
  var stackGlobalsSymbol = Symbol.for("__stack-globals");
  globalVar[stackGlobalsSymbol] ??= {};

  // ../stack-shared/dist/esm/utils/errors.js
  function throwErr(...args) {
    if (typeof args[0] === "string") throw new StackAssertionError(args[0], args[1]);
    else if (args[0] instanceof Error) throw args[0];
    else throw new StatusError(...args);
  }
  function removeStacktraceNameLine(stack) {
    const addsNameLine = (/* @__PURE__ */ new Error()).stack?.startsWith("Error\n");
    return stack.split("\n").slice(addsNameLine ? 1 : 0).join("\n");
  }
  function concatStacktraces(first, ...errors) {
    const addsEmptyLineAtEnd = first.stack?.endsWith("\n");
    const separator = removeStacktraceNameLine((/* @__PURE__ */ new Error()).stack ?? "").split("\n")[0];
    for (const error of errors) {
      const toAppend = removeStacktraceNameLine(error.stack ?? "");
      first.stack += (addsEmptyLineAtEnd ? "" : "\n") + separator + "\n" + toAppend;
    }
  }
  var StackAssertionError = class extends Error {
    constructor(message, extraData) {
      const disclaimer = `

This is likely an error in Stack. Please make sure you are running the newest version and report it.`;
      super(`${message}${message.endsWith(disclaimer) ? "" : disclaimer}`, pick(extraData ?? {}, ["cause"]));
      this.extraData = extraData;
      Object.defineProperty(this, "customCaptureExtraArgs", {
        get() {
          return [this.extraData];
        },
        enumerable: false
      });
      if (process.env.NEXT_PUBLIC_STACK_DEBUGGER_ON_ASSERTION_ERROR === "true") debugger;
    }
  };
  StackAssertionError.prototype.name = "StackAssertionError";
  function errorToNiceString(error) {
    if (!(error instanceof Error)) return `${typeof error}<${nicify(error)}>`;
    return nicify(error, { maxDepth: 8 });
  }
  var errorSinks = /* @__PURE__ */ new Set();
  function registerErrorSink(sink) {
    if (errorSinks.has(sink)) return;
    errorSinks.add(sink);
  }
  registerErrorSink((location, error, ...extraArgs) => {
    console.error(`\x1B[41mCaptured error in ${location}:`, errorToNiceString(error), ...extraArgs, "\x1B[0m");
  });
  registerErrorSink((location, error, ...extraArgs) => {
    globalVar.stackCapturedErrors = globalVar.stackCapturedErrors ?? [];
    globalVar.stackCapturedErrors.push({
      location,
      error,
      extraArgs
    });
  });
  function captureError(location, error) {
    for (const sink of errorSinks) sink(location, error, ...error && (typeof error === "object" || typeof error === "function") && "customCaptureExtraArgs" in error && Array.isArray(error.customCaptureExtraArgs) ? error.customCaptureExtraArgs : []);
  }
  var _a;
  var StatusError = (_a = class extends Error {
    constructor(status, message) {
      if (typeof status === "object") {
        message ??= status.message;
        status = status.statusCode;
      }
      super(message);
      this.__stackStatusErrorBrand = "stack-status-error-brand-sentinel";
      this.name = "StatusError";
      this.statusCode = status;
      if (!message) throw new StackAssertionError("StatusError always requires a message unless a Status object is passed", { cause: this });
    }
    static isStatusError(error) {
      return typeof error === "object" && error !== null && "__stackStatusErrorBrand" in error && error.__stackStatusErrorBrand === "stack-status-error-brand-sentinel";
    }
    isClientError() {
      return this.statusCode >= 400 && this.statusCode < 500;
    }
    isServerError() {
      return !this.isClientError();
    }
    getStatusCode() {
      return this.statusCode;
    }
    getBody() {
      return new TextEncoder().encode(this.message);
    }
    getHeaders() {
      return { "Content-Type": ["text/plain; charset=utf-8"] };
    }
    toDescriptiveJson() {
      return {
        status_code: this.getStatusCode(),
        message: this.message,
        headers: this.getHeaders()
      };
    }
    /**
    * @deprecated this is not a good way to make status errors human-readable, use toDescriptiveJson instead
    */
    toHttpJson() {
      return {
        status_code: this.statusCode,
        body: this.message,
        headers: this.getHeaders()
      };
    }
  }, _a.BadRequest = {
    statusCode: 400,
    message: "Bad Request"
  }, _a.Unauthorized = {
    statusCode: 401,
    message: "Unauthorized"
  }, _a.PaymentRequired = {
    statusCode: 402,
    message: "Payment Required"
  }, _a.Forbidden = {
    statusCode: 403,
    message: "Forbidden"
  }, _a.NotFound = {
    statusCode: 404,
    message: "Not Found"
  }, _a.MethodNotAllowed = {
    statusCode: 405,
    message: "Method Not Allowed"
  }, _a.NotAcceptable = {
    statusCode: 406,
    message: "Not Acceptable"
  }, _a.ProxyAuthenticationRequired = {
    statusCode: 407,
    message: "Proxy Authentication Required"
  }, _a.RequestTimeout = {
    statusCode: 408,
    message: "Request Timeout"
  }, _a.Conflict = {
    statusCode: 409,
    message: "Conflict"
  }, _a.Gone = {
    statusCode: 410,
    message: "Gone"
  }, _a.LengthRequired = {
    statusCode: 411,
    message: "Length Required"
  }, _a.PreconditionFailed = {
    statusCode: 412,
    message: "Precondition Failed"
  }, _a.PayloadTooLarge = {
    statusCode: 413,
    message: "Payload Too Large"
  }, _a.URITooLong = {
    statusCode: 414,
    message: "URI Too Long"
  }, _a.UnsupportedMediaType = {
    statusCode: 415,
    message: "Unsupported Media Type"
  }, _a.RangeNotSatisfiable = {
    statusCode: 416,
    message: "Range Not Satisfiable"
  }, _a.ExpectationFailed = {
    statusCode: 417,
    message: "Expectation Failed"
  }, _a.ImATeapot = {
    statusCode: 418,
    message: "I'm a teapot"
  }, _a.MisdirectedRequest = {
    statusCode: 421,
    message: "Misdirected Request"
  }, _a.UnprocessableEntity = {
    statusCode: 422,
    message: "Unprocessable Entity"
  }, _a.Locked = {
    statusCode: 423,
    message: "Locked"
  }, _a.FailedDependency = {
    statusCode: 424,
    message: "Failed Dependency"
  }, _a.TooEarly = {
    statusCode: 425,
    message: "Too Early"
  }, _a.UpgradeRequired = {
    statusCode: 426,
    message: "Upgrade Required"
  }, _a.PreconditionRequired = {
    statusCode: 428,
    message: "Precondition Required"
  }, _a.TooManyRequests = {
    statusCode: 429,
    message: "Too Many Requests"
  }, _a.RequestHeaderFieldsTooLarge = {
    statusCode: 431,
    message: "Request Header Fields Too Large"
  }, _a.UnavailableForLegalReasons = {
    statusCode: 451,
    message: "Unavailable For Legal Reasons"
  }, _a.InternalServerError = {
    statusCode: 500,
    message: "Internal Server Error"
  }, _a.NotImplemented = {
    statusCode: 501,
    message: "Not Implemented"
  }, _a.BadGateway = {
    statusCode: 502,
    message: "Bad Gateway"
  }, _a.ServiceUnavailable = {
    statusCode: 503,
    message: "Service Unavailable"
  }, _a.GatewayTimeout = {
    statusCode: 504,
    message: "Gateway Timeout"
  }, _a.HTTPVersionNotSupported = {
    statusCode: 505,
    message: "HTTP Version Not Supported"
  }, _a.VariantAlsoNegotiates = {
    statusCode: 506,
    message: "Variant Also Negotiates"
  }, _a.InsufficientStorage = {
    statusCode: 507,
    message: "Insufficient Storage"
  }, _a.LoopDetected = {
    statusCode: 508,
    message: "Loop Detected"
  }, _a.NotExtended = {
    statusCode: 510,
    message: "Not Extended"
  }, _a.NetworkAuthenticationRequired = {
    statusCode: 511,
    message: "Network Authentication Required"
  }, _a);
  StatusError.prototype.name = "StatusError";

  // ../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
  function r4(e15) {
    var t, f, n3 = "";
    if ("string" == typeof e15 || "number" == typeof e15) n3 += e15;
    else if ("object" == typeof e15) if (Array.isArray(e15)) {
      var o7 = e15.length;
      for (t = 0; t < o7; t++) e15[t] && (f = r4(e15[t])) && (n3 && (n3 += " "), n3 += f);
    } else for (f in e15) e15[f] && (n3 && (n3 += " "), n3 += f);
    return n3;
  }
  function clsx() {
    for (var e15, t, f = 0, n3 = "", o7 = arguments.length; f < o7; f++) (e15 = arguments[f]) && (t = r4(e15)) && (n3 && (n3 += " "), n3 += t);
    return n3;
  }

  // ../../node_modules/.pnpm/tailwind-merge@2.5.4/node_modules/tailwind-merge/dist/bundle-mjs.mjs
  var CLASS_PART_SEPARATOR = "-";
  var createClassGroupUtils = (config) => {
    const classMap = createClassMap(config);
    const {
      conflictingClassGroups,
      conflictingClassGroupModifiers
    } = config;
    const getClassGroupId = (className) => {
      const classParts = className.split(CLASS_PART_SEPARATOR);
      if (classParts[0] === "" && classParts.length !== 1) {
        classParts.shift();
      }
      return getGroupRecursive(classParts, classMap) || getGroupIdForArbitraryProperty(className);
    };
    const getConflictingClassGroupIds = (classGroupId, hasPostfixModifier) => {
      const conflicts = conflictingClassGroups[classGroupId] || [];
      if (hasPostfixModifier && conflictingClassGroupModifiers[classGroupId]) {
        return [...conflicts, ...conflictingClassGroupModifiers[classGroupId]];
      }
      return conflicts;
    };
    return {
      getClassGroupId,
      getConflictingClassGroupIds
    };
  };
  var getGroupRecursive = (classParts, classPartObject) => {
    if (classParts.length === 0) {
      return classPartObject.classGroupId;
    }
    const currentClassPart = classParts[0];
    const nextClassPartObject = classPartObject.nextPart.get(currentClassPart);
    const classGroupFromNextClassPart = nextClassPartObject ? getGroupRecursive(classParts.slice(1), nextClassPartObject) : void 0;
    if (classGroupFromNextClassPart) {
      return classGroupFromNextClassPart;
    }
    if (classPartObject.validators.length === 0) {
      return void 0;
    }
    const classRest = classParts.join(CLASS_PART_SEPARATOR);
    return classPartObject.validators.find(({
      validator
    }) => validator(classRest))?.classGroupId;
  };
  var arbitraryPropertyRegex = /^\[(.+)\]$/;
  var getGroupIdForArbitraryProperty = (className) => {
    if (arbitraryPropertyRegex.test(className)) {
      const arbitraryPropertyClassName = arbitraryPropertyRegex.exec(className)[1];
      const property = arbitraryPropertyClassName?.substring(0, arbitraryPropertyClassName.indexOf(":"));
      if (property) {
        return "arbitrary.." + property;
      }
    }
  };
  var createClassMap = (config) => {
    const {
      theme,
      prefix
    } = config;
    const classMap = {
      nextPart: /* @__PURE__ */ new Map(),
      validators: []
    };
    const prefixedClassGroupEntries = getPrefixedClassGroupEntries(Object.entries(config.classGroups), prefix);
    prefixedClassGroupEntries.forEach(([classGroupId, classGroup]) => {
      processClassesRecursively(classGroup, classMap, classGroupId, theme);
    });
    return classMap;
  };
  var processClassesRecursively = (classGroup, classPartObject, classGroupId, theme) => {
    classGroup.forEach((classDefinition) => {
      if (typeof classDefinition === "string") {
        const classPartObjectToEdit = classDefinition === "" ? classPartObject : getPart(classPartObject, classDefinition);
        classPartObjectToEdit.classGroupId = classGroupId;
        return;
      }
      if (typeof classDefinition === "function") {
        if (isThemeGetter(classDefinition)) {
          processClassesRecursively(classDefinition(theme), classPartObject, classGroupId, theme);
          return;
        }
        classPartObject.validators.push({
          validator: classDefinition,
          classGroupId
        });
        return;
      }
      Object.entries(classDefinition).forEach(([key, classGroup2]) => {
        processClassesRecursively(classGroup2, getPart(classPartObject, key), classGroupId, theme);
      });
    });
  };
  var getPart = (classPartObject, path) => {
    let currentClassPartObject = classPartObject;
    path.split(CLASS_PART_SEPARATOR).forEach((pathPart) => {
      if (!currentClassPartObject.nextPart.has(pathPart)) {
        currentClassPartObject.nextPart.set(pathPart, {
          nextPart: /* @__PURE__ */ new Map(),
          validators: []
        });
      }
      currentClassPartObject = currentClassPartObject.nextPart.get(pathPart);
    });
    return currentClassPartObject;
  };
  var isThemeGetter = (func) => func.isThemeGetter;
  var getPrefixedClassGroupEntries = (classGroupEntries, prefix) => {
    if (!prefix) {
      return classGroupEntries;
    }
    return classGroupEntries.map(([classGroupId, classGroup]) => {
      const prefixedClassGroup = classGroup.map((classDefinition) => {
        if (typeof classDefinition === "string") {
          return prefix + classDefinition;
        }
        if (typeof classDefinition === "object") {
          return Object.fromEntries(Object.entries(classDefinition).map(([key, value]) => [prefix + key, value]));
        }
        return classDefinition;
      });
      return [classGroupId, prefixedClassGroup];
    });
  };
  var createLruCache = (maxCacheSize) => {
    if (maxCacheSize < 1) {
      return {
        get: () => void 0,
        set: () => {
        }
      };
    }
    let cacheSize = 0;
    let cache = /* @__PURE__ */ new Map();
    let previousCache = /* @__PURE__ */ new Map();
    const update = (key, value) => {
      cache.set(key, value);
      cacheSize++;
      if (cacheSize > maxCacheSize) {
        cacheSize = 0;
        previousCache = cache;
        cache = /* @__PURE__ */ new Map();
      }
    };
    return {
      get(key) {
        let value = cache.get(key);
        if (value !== void 0) {
          return value;
        }
        if ((value = previousCache.get(key)) !== void 0) {
          update(key, value);
          return value;
        }
      },
      set(key, value) {
        if (cache.has(key)) {
          cache.set(key, value);
        } else {
          update(key, value);
        }
      }
    };
  };
  var IMPORTANT_MODIFIER = "!";
  var createParseClassName = (config) => {
    const {
      separator,
      experimentalParseClassName
    } = config;
    const isSeparatorSingleCharacter = separator.length === 1;
    const firstSeparatorCharacter = separator[0];
    const separatorLength = separator.length;
    const parseClassName = (className) => {
      const modifiers = [];
      let bracketDepth = 0;
      let modifierStart = 0;
      let postfixModifierPosition;
      for (let index3 = 0; index3 < className.length; index3++) {
        let currentCharacter = className[index3];
        if (bracketDepth === 0) {
          if (currentCharacter === firstSeparatorCharacter && (isSeparatorSingleCharacter || className.slice(index3, index3 + separatorLength) === separator)) {
            modifiers.push(className.slice(modifierStart, index3));
            modifierStart = index3 + separatorLength;
            continue;
          }
          if (currentCharacter === "/") {
            postfixModifierPosition = index3;
            continue;
          }
        }
        if (currentCharacter === "[") {
          bracketDepth++;
        } else if (currentCharacter === "]") {
          bracketDepth--;
        }
      }
      const baseClassNameWithImportantModifier = modifiers.length === 0 ? className : className.substring(modifierStart);
      const hasImportantModifier = baseClassNameWithImportantModifier.startsWith(IMPORTANT_MODIFIER);
      const baseClassName = hasImportantModifier ? baseClassNameWithImportantModifier.substring(1) : baseClassNameWithImportantModifier;
      const maybePostfixModifierPosition = postfixModifierPosition && postfixModifierPosition > modifierStart ? postfixModifierPosition - modifierStart : void 0;
      return {
        modifiers,
        hasImportantModifier,
        baseClassName,
        maybePostfixModifierPosition
      };
    };
    if (experimentalParseClassName) {
      return (className) => experimentalParseClassName({
        className,
        parseClassName
      });
    }
    return parseClassName;
  };
  var sortModifiers = (modifiers) => {
    if (modifiers.length <= 1) {
      return modifiers;
    }
    const sortedModifiers = [];
    let unsortedModifiers = [];
    modifiers.forEach((modifier) => {
      const isArbitraryVariant = modifier[0] === "[";
      if (isArbitraryVariant) {
        sortedModifiers.push(...unsortedModifiers.sort(), modifier);
        unsortedModifiers = [];
      } else {
        unsortedModifiers.push(modifier);
      }
    });
    sortedModifiers.push(...unsortedModifiers.sort());
    return sortedModifiers;
  };
  var createConfigUtils = (config) => ({
    cache: createLruCache(config.cacheSize),
    parseClassName: createParseClassName(config),
    ...createClassGroupUtils(config)
  });
  var SPLIT_CLASSES_REGEX = /\s+/;
  var mergeClassList = (classList, configUtils) => {
    const {
      parseClassName,
      getClassGroupId,
      getConflictingClassGroupIds
    } = configUtils;
    const classGroupsInConflict = [];
    const classNames = classList.trim().split(SPLIT_CLASSES_REGEX);
    let result = "";
    for (let index3 = classNames.length - 1; index3 >= 0; index3 -= 1) {
      const originalClassName = classNames[index3];
      const {
        modifiers,
        hasImportantModifier,
        baseClassName,
        maybePostfixModifierPosition
      } = parseClassName(originalClassName);
      let hasPostfixModifier = Boolean(maybePostfixModifierPosition);
      let classGroupId = getClassGroupId(hasPostfixModifier ? baseClassName.substring(0, maybePostfixModifierPosition) : baseClassName);
      if (!classGroupId) {
        if (!hasPostfixModifier) {
          result = originalClassName + (result.length > 0 ? " " + result : result);
          continue;
        }
        classGroupId = getClassGroupId(baseClassName);
        if (!classGroupId) {
          result = originalClassName + (result.length > 0 ? " " + result : result);
          continue;
        }
        hasPostfixModifier = false;
      }
      const variantModifier = sortModifiers(modifiers).join(":");
      const modifierId = hasImportantModifier ? variantModifier + IMPORTANT_MODIFIER : variantModifier;
      const classId = modifierId + classGroupId;
      if (classGroupsInConflict.includes(classId)) {
        continue;
      }
      classGroupsInConflict.push(classId);
      const conflictGroups = getConflictingClassGroupIds(classGroupId, hasPostfixModifier);
      for (let i = 0; i < conflictGroups.length; ++i) {
        const group = conflictGroups[i];
        classGroupsInConflict.push(modifierId + group);
      }
      result = originalClassName + (result.length > 0 ? " " + result : result);
    }
    return result;
  };
  function twJoin() {
    let index3 = 0;
    let argument;
    let resolvedValue;
    let string2 = "";
    while (index3 < arguments.length) {
      if (argument = arguments[index3++]) {
        if (resolvedValue = toValue(argument)) {
          string2 && (string2 += " ");
          string2 += resolvedValue;
        }
      }
    }
    return string2;
  }
  var toValue = (mix) => {
    if (typeof mix === "string") {
      return mix;
    }
    let resolvedValue;
    let string2 = "";
    for (let k = 0; k < mix.length; k++) {
      if (mix[k]) {
        if (resolvedValue = toValue(mix[k])) {
          string2 && (string2 += " ");
          string2 += resolvedValue;
        }
      }
    }
    return string2;
  };
  function createTailwindMerge(createConfigFirst, ...createConfigRest) {
    let configUtils;
    let cacheGet;
    let cacheSet;
    let functionToCall = initTailwindMerge;
    function initTailwindMerge(classList) {
      const config = createConfigRest.reduce((previousConfig, createConfigCurrent) => createConfigCurrent(previousConfig), createConfigFirst());
      configUtils = createConfigUtils(config);
      cacheGet = configUtils.cache.get;
      cacheSet = configUtils.cache.set;
      functionToCall = tailwindMerge;
      return tailwindMerge(classList);
    }
    function tailwindMerge(classList) {
      const cachedResult = cacheGet(classList);
      if (cachedResult) {
        return cachedResult;
      }
      const result = mergeClassList(classList, configUtils);
      cacheSet(classList, result);
      return result;
    }
    return function callTailwindMerge() {
      return functionToCall(twJoin.apply(null, arguments));
    };
  }
  var fromTheme = (key) => {
    const themeGetter = (theme) => theme[key] || [];
    themeGetter.isThemeGetter = true;
    return themeGetter;
  };
  var arbitraryValueRegex = /^\[(?:([a-z-]+):)?(.+)\]$/i;
  var fractionRegex = /^\d+\/\d+$/;
  var stringLengths = /* @__PURE__ */ new Set(["px", "full", "screen"]);
  var tshirtUnitRegex = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/;
  var lengthUnitRegex = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/;
  var colorFunctionRegex = /^(rgba?|hsla?|hwb|(ok)?(lab|lch))\(.+\)$/;
  var shadowRegex = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/;
  var imageRegex = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/;
  var isLength = (value) => isNumber(value) || stringLengths.has(value) || fractionRegex.test(value);
  var isArbitraryLength = (value) => getIsArbitraryValue(value, "length", isLengthOnly);
  var isNumber = (value) => Boolean(value) && !Number.isNaN(Number(value));
  var isArbitraryNumber = (value) => getIsArbitraryValue(value, "number", isNumber);
  var isInteger = (value) => Boolean(value) && Number.isInteger(Number(value));
  var isPercent = (value) => value.endsWith("%") && isNumber(value.slice(0, -1));
  var isArbitraryValue = (value) => arbitraryValueRegex.test(value);
  var isTshirtSize = (value) => tshirtUnitRegex.test(value);
  var sizeLabels = /* @__PURE__ */ new Set(["length", "size", "percentage"]);
  var isArbitrarySize = (value) => getIsArbitraryValue(value, sizeLabels, isNever);
  var isArbitraryPosition = (value) => getIsArbitraryValue(value, "position", isNever);
  var imageLabels = /* @__PURE__ */ new Set(["image", "url"]);
  var isArbitraryImage = (value) => getIsArbitraryValue(value, imageLabels, isImage);
  var isArbitraryShadow = (value) => getIsArbitraryValue(value, "", isShadow);
  var isAny = () => true;
  var getIsArbitraryValue = (value, label, testValue) => {
    const result = arbitraryValueRegex.exec(value);
    if (result) {
      if (result[1]) {
        return typeof label === "string" ? result[1] === label : label.has(result[1]);
      }
      return testValue(result[2]);
    }
    return false;
  };
  var isLengthOnly = (value) => (
    // `colorFunctionRegex` check is necessary because color functions can have percentages in them which which would be incorrectly classified as lengths.
    // For example, `hsl(0 0% 0%)` would be classified as a length without this check.
    // I could also use lookbehind assertion in `lengthUnitRegex` but that isn't supported widely enough.
    lengthUnitRegex.test(value) && !colorFunctionRegex.test(value)
  );
  var isNever = () => false;
  var isShadow = (value) => shadowRegex.test(value);
  var isImage = (value) => imageRegex.test(value);
  var getDefaultConfig = () => {
    const colors = fromTheme("colors");
    const spacing = fromTheme("spacing");
    const blur = fromTheme("blur");
    const brightness = fromTheme("brightness");
    const borderColor = fromTheme("borderColor");
    const borderRadius = fromTheme("borderRadius");
    const borderSpacing = fromTheme("borderSpacing");
    const borderWidth = fromTheme("borderWidth");
    const contrast = fromTheme("contrast");
    const grayscale = fromTheme("grayscale");
    const hueRotate = fromTheme("hueRotate");
    const invert = fromTheme("invert");
    const gap = fromTheme("gap");
    const gradientColorStops = fromTheme("gradientColorStops");
    const gradientColorStopPositions = fromTheme("gradientColorStopPositions");
    const inset = fromTheme("inset");
    const margin = fromTheme("margin");
    const opacity = fromTheme("opacity");
    const padding = fromTheme("padding");
    const saturate = fromTheme("saturate");
    const scale = fromTheme("scale");
    const sepia = fromTheme("sepia");
    const skew = fromTheme("skew");
    const space = fromTheme("space");
    const translate = fromTheme("translate");
    const getOverscroll = () => ["auto", "contain", "none"];
    const getOverflow = () => ["auto", "hidden", "clip", "visible", "scroll"];
    const getSpacingWithAutoAndArbitrary = () => ["auto", isArbitraryValue, spacing];
    const getSpacingWithArbitrary = () => [isArbitraryValue, spacing];
    const getLengthWithEmptyAndArbitrary = () => ["", isLength, isArbitraryLength];
    const getNumberWithAutoAndArbitrary = () => ["auto", isNumber, isArbitraryValue];
    const getPositions = () => ["bottom", "center", "left", "left-bottom", "left-top", "right", "right-bottom", "right-top", "top"];
    const getLineStyles = () => ["solid", "dashed", "dotted", "double", "none"];
    const getBlendModes = () => ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
    const getAlign = () => ["start", "end", "center", "between", "around", "evenly", "stretch"];
    const getZeroAndEmpty = () => ["", "0", isArbitraryValue];
    const getBreaks = () => ["auto", "avoid", "all", "avoid-page", "page", "left", "right", "column"];
    const getNumberAndArbitrary = () => [isNumber, isArbitraryValue];
    return {
      cacheSize: 500,
      separator: ":",
      theme: {
        colors: [isAny],
        spacing: [isLength, isArbitraryLength],
        blur: ["none", "", isTshirtSize, isArbitraryValue],
        brightness: getNumberAndArbitrary(),
        borderColor: [colors],
        borderRadius: ["none", "", "full", isTshirtSize, isArbitraryValue],
        borderSpacing: getSpacingWithArbitrary(),
        borderWidth: getLengthWithEmptyAndArbitrary(),
        contrast: getNumberAndArbitrary(),
        grayscale: getZeroAndEmpty(),
        hueRotate: getNumberAndArbitrary(),
        invert: getZeroAndEmpty(),
        gap: getSpacingWithArbitrary(),
        gradientColorStops: [colors],
        gradientColorStopPositions: [isPercent, isArbitraryLength],
        inset: getSpacingWithAutoAndArbitrary(),
        margin: getSpacingWithAutoAndArbitrary(),
        opacity: getNumberAndArbitrary(),
        padding: getSpacingWithArbitrary(),
        saturate: getNumberAndArbitrary(),
        scale: getNumberAndArbitrary(),
        sepia: getZeroAndEmpty(),
        skew: getNumberAndArbitrary(),
        space: getSpacingWithArbitrary(),
        translate: getSpacingWithArbitrary()
      },
      classGroups: {
        // Layout
        /**
         * Aspect Ratio
         * @see https://tailwindcss.com/docs/aspect-ratio
         */
        aspect: [{
          aspect: ["auto", "square", "video", isArbitraryValue]
        }],
        /**
         * Container
         * @see https://tailwindcss.com/docs/container
         */
        container: ["container"],
        /**
         * Columns
         * @see https://tailwindcss.com/docs/columns
         */
        columns: [{
          columns: [isTshirtSize]
        }],
        /**
         * Break After
         * @see https://tailwindcss.com/docs/break-after
         */
        "break-after": [{
          "break-after": getBreaks()
        }],
        /**
         * Break Before
         * @see https://tailwindcss.com/docs/break-before
         */
        "break-before": [{
          "break-before": getBreaks()
        }],
        /**
         * Break Inside
         * @see https://tailwindcss.com/docs/break-inside
         */
        "break-inside": [{
          "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"]
        }],
        /**
         * Box Decoration Break
         * @see https://tailwindcss.com/docs/box-decoration-break
         */
        "box-decoration": [{
          "box-decoration": ["slice", "clone"]
        }],
        /**
         * Box Sizing
         * @see https://tailwindcss.com/docs/box-sizing
         */
        box: [{
          box: ["border", "content"]
        }],
        /**
         * Display
         * @see https://tailwindcss.com/docs/display
         */
        display: ["block", "inline-block", "inline", "flex", "inline-flex", "table", "inline-table", "table-caption", "table-cell", "table-column", "table-column-group", "table-footer-group", "table-header-group", "table-row-group", "table-row", "flow-root", "grid", "inline-grid", "contents", "list-item", "hidden"],
        /**
         * Floats
         * @see https://tailwindcss.com/docs/float
         */
        float: [{
          float: ["right", "left", "none", "start", "end"]
        }],
        /**
         * Clear
         * @see https://tailwindcss.com/docs/clear
         */
        clear: [{
          clear: ["left", "right", "both", "none", "start", "end"]
        }],
        /**
         * Isolation
         * @see https://tailwindcss.com/docs/isolation
         */
        isolation: ["isolate", "isolation-auto"],
        /**
         * Object Fit
         * @see https://tailwindcss.com/docs/object-fit
         */
        "object-fit": [{
          object: ["contain", "cover", "fill", "none", "scale-down"]
        }],
        /**
         * Object Position
         * @see https://tailwindcss.com/docs/object-position
         */
        "object-position": [{
          object: [...getPositions(), isArbitraryValue]
        }],
        /**
         * Overflow
         * @see https://tailwindcss.com/docs/overflow
         */
        overflow: [{
          overflow: getOverflow()
        }],
        /**
         * Overflow X
         * @see https://tailwindcss.com/docs/overflow
         */
        "overflow-x": [{
          "overflow-x": getOverflow()
        }],
        /**
         * Overflow Y
         * @see https://tailwindcss.com/docs/overflow
         */
        "overflow-y": [{
          "overflow-y": getOverflow()
        }],
        /**
         * Overscroll Behavior
         * @see https://tailwindcss.com/docs/overscroll-behavior
         */
        overscroll: [{
          overscroll: getOverscroll()
        }],
        /**
         * Overscroll Behavior X
         * @see https://tailwindcss.com/docs/overscroll-behavior
         */
        "overscroll-x": [{
          "overscroll-x": getOverscroll()
        }],
        /**
         * Overscroll Behavior Y
         * @see https://tailwindcss.com/docs/overscroll-behavior
         */
        "overscroll-y": [{
          "overscroll-y": getOverscroll()
        }],
        /**
         * Position
         * @see https://tailwindcss.com/docs/position
         */
        position: ["static", "fixed", "absolute", "relative", "sticky"],
        /**
         * Top / Right / Bottom / Left
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        inset: [{
          inset: [inset]
        }],
        /**
         * Right / Left
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        "inset-x": [{
          "inset-x": [inset]
        }],
        /**
         * Top / Bottom
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        "inset-y": [{
          "inset-y": [inset]
        }],
        /**
         * Start
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        start: [{
          start: [inset]
        }],
        /**
         * End
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        end: [{
          end: [inset]
        }],
        /**
         * Top
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        top: [{
          top: [inset]
        }],
        /**
         * Right
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        right: [{
          right: [inset]
        }],
        /**
         * Bottom
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        bottom: [{
          bottom: [inset]
        }],
        /**
         * Left
         * @see https://tailwindcss.com/docs/top-right-bottom-left
         */
        left: [{
          left: [inset]
        }],
        /**
         * Visibility
         * @see https://tailwindcss.com/docs/visibility
         */
        visibility: ["visible", "invisible", "collapse"],
        /**
         * Z-Index
         * @see https://tailwindcss.com/docs/z-index
         */
        z: [{
          z: ["auto", isInteger, isArbitraryValue]
        }],
        // Flexbox and Grid
        /**
         * Flex Basis
         * @see https://tailwindcss.com/docs/flex-basis
         */
        basis: [{
          basis: getSpacingWithAutoAndArbitrary()
        }],
        /**
         * Flex Direction
         * @see https://tailwindcss.com/docs/flex-direction
         */
        "flex-direction": [{
          flex: ["row", "row-reverse", "col", "col-reverse"]
        }],
        /**
         * Flex Wrap
         * @see https://tailwindcss.com/docs/flex-wrap
         */
        "flex-wrap": [{
          flex: ["wrap", "wrap-reverse", "nowrap"]
        }],
        /**
         * Flex
         * @see https://tailwindcss.com/docs/flex
         */
        flex: [{
          flex: ["1", "auto", "initial", "none", isArbitraryValue]
        }],
        /**
         * Flex Grow
         * @see https://tailwindcss.com/docs/flex-grow
         */
        grow: [{
          grow: getZeroAndEmpty()
        }],
        /**
         * Flex Shrink
         * @see https://tailwindcss.com/docs/flex-shrink
         */
        shrink: [{
          shrink: getZeroAndEmpty()
        }],
        /**
         * Order
         * @see https://tailwindcss.com/docs/order
         */
        order: [{
          order: ["first", "last", "none", isInteger, isArbitraryValue]
        }],
        /**
         * Grid Template Columns
         * @see https://tailwindcss.com/docs/grid-template-columns
         */
        "grid-cols": [{
          "grid-cols": [isAny]
        }],
        /**
         * Grid Column Start / End
         * @see https://tailwindcss.com/docs/grid-column
         */
        "col-start-end": [{
          col: ["auto", {
            span: ["full", isInteger, isArbitraryValue]
          }, isArbitraryValue]
        }],
        /**
         * Grid Column Start
         * @see https://tailwindcss.com/docs/grid-column
         */
        "col-start": [{
          "col-start": getNumberWithAutoAndArbitrary()
        }],
        /**
         * Grid Column End
         * @see https://tailwindcss.com/docs/grid-column
         */
        "col-end": [{
          "col-end": getNumberWithAutoAndArbitrary()
        }],
        /**
         * Grid Template Rows
         * @see https://tailwindcss.com/docs/grid-template-rows
         */
        "grid-rows": [{
          "grid-rows": [isAny]
        }],
        /**
         * Grid Row Start / End
         * @see https://tailwindcss.com/docs/grid-row
         */
        "row-start-end": [{
          row: ["auto", {
            span: [isInteger, isArbitraryValue]
          }, isArbitraryValue]
        }],
        /**
         * Grid Row Start
         * @see https://tailwindcss.com/docs/grid-row
         */
        "row-start": [{
          "row-start": getNumberWithAutoAndArbitrary()
        }],
        /**
         * Grid Row End
         * @see https://tailwindcss.com/docs/grid-row
         */
        "row-end": [{
          "row-end": getNumberWithAutoAndArbitrary()
        }],
        /**
         * Grid Auto Flow
         * @see https://tailwindcss.com/docs/grid-auto-flow
         */
        "grid-flow": [{
          "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"]
        }],
        /**
         * Grid Auto Columns
         * @see https://tailwindcss.com/docs/grid-auto-columns
         */
        "auto-cols": [{
          "auto-cols": ["auto", "min", "max", "fr", isArbitraryValue]
        }],
        /**
         * Grid Auto Rows
         * @see https://tailwindcss.com/docs/grid-auto-rows
         */
        "auto-rows": [{
          "auto-rows": ["auto", "min", "max", "fr", isArbitraryValue]
        }],
        /**
         * Gap
         * @see https://tailwindcss.com/docs/gap
         */
        gap: [{
          gap: [gap]
        }],
        /**
         * Gap X
         * @see https://tailwindcss.com/docs/gap
         */
        "gap-x": [{
          "gap-x": [gap]
        }],
        /**
         * Gap Y
         * @see https://tailwindcss.com/docs/gap
         */
        "gap-y": [{
          "gap-y": [gap]
        }],
        /**
         * Justify Content
         * @see https://tailwindcss.com/docs/justify-content
         */
        "justify-content": [{
          justify: ["normal", ...getAlign()]
        }],
        /**
         * Justify Items
         * @see https://tailwindcss.com/docs/justify-items
         */
        "justify-items": [{
          "justify-items": ["start", "end", "center", "stretch"]
        }],
        /**
         * Justify Self
         * @see https://tailwindcss.com/docs/justify-self
         */
        "justify-self": [{
          "justify-self": ["auto", "start", "end", "center", "stretch"]
        }],
        /**
         * Align Content
         * @see https://tailwindcss.com/docs/align-content
         */
        "align-content": [{
          content: ["normal", ...getAlign(), "baseline"]
        }],
        /**
         * Align Items
         * @see https://tailwindcss.com/docs/align-items
         */
        "align-items": [{
          items: ["start", "end", "center", "baseline", "stretch"]
        }],
        /**
         * Align Self
         * @see https://tailwindcss.com/docs/align-self
         */
        "align-self": [{
          self: ["auto", "start", "end", "center", "stretch", "baseline"]
        }],
        /**
         * Place Content
         * @see https://tailwindcss.com/docs/place-content
         */
        "place-content": [{
          "place-content": [...getAlign(), "baseline"]
        }],
        /**
         * Place Items
         * @see https://tailwindcss.com/docs/place-items
         */
        "place-items": [{
          "place-items": ["start", "end", "center", "baseline", "stretch"]
        }],
        /**
         * Place Self
         * @see https://tailwindcss.com/docs/place-self
         */
        "place-self": [{
          "place-self": ["auto", "start", "end", "center", "stretch"]
        }],
        // Spacing
        /**
         * Padding
         * @see https://tailwindcss.com/docs/padding
         */
        p: [{
          p: [padding]
        }],
        /**
         * Padding X
         * @see https://tailwindcss.com/docs/padding
         */
        px: [{
          px: [padding]
        }],
        /**
         * Padding Y
         * @see https://tailwindcss.com/docs/padding
         */
        py: [{
          py: [padding]
        }],
        /**
         * Padding Start
         * @see https://tailwindcss.com/docs/padding
         */
        ps: [{
          ps: [padding]
        }],
        /**
         * Padding End
         * @see https://tailwindcss.com/docs/padding
         */
        pe: [{
          pe: [padding]
        }],
        /**
         * Padding Top
         * @see https://tailwindcss.com/docs/padding
         */
        pt: [{
          pt: [padding]
        }],
        /**
         * Padding Right
         * @see https://tailwindcss.com/docs/padding
         */
        pr: [{
          pr: [padding]
        }],
        /**
         * Padding Bottom
         * @see https://tailwindcss.com/docs/padding
         */
        pb: [{
          pb: [padding]
        }],
        /**
         * Padding Left
         * @see https://tailwindcss.com/docs/padding
         */
        pl: [{
          pl: [padding]
        }],
        /**
         * Margin
         * @see https://tailwindcss.com/docs/margin
         */
        m: [{
          m: [margin]
        }],
        /**
         * Margin X
         * @see https://tailwindcss.com/docs/margin
         */
        mx: [{
          mx: [margin]
        }],
        /**
         * Margin Y
         * @see https://tailwindcss.com/docs/margin
         */
        my: [{
          my: [margin]
        }],
        /**
         * Margin Start
         * @see https://tailwindcss.com/docs/margin
         */
        ms: [{
          ms: [margin]
        }],
        /**
         * Margin End
         * @see https://tailwindcss.com/docs/margin
         */
        me: [{
          me: [margin]
        }],
        /**
         * Margin Top
         * @see https://tailwindcss.com/docs/margin
         */
        mt: [{
          mt: [margin]
        }],
        /**
         * Margin Right
         * @see https://tailwindcss.com/docs/margin
         */
        mr: [{
          mr: [margin]
        }],
        /**
         * Margin Bottom
         * @see https://tailwindcss.com/docs/margin
         */
        mb: [{
          mb: [margin]
        }],
        /**
         * Margin Left
         * @see https://tailwindcss.com/docs/margin
         */
        ml: [{
          ml: [margin]
        }],
        /**
         * Space Between X
         * @see https://tailwindcss.com/docs/space
         */
        "space-x": [{
          "space-x": [space]
        }],
        /**
         * Space Between X Reverse
         * @see https://tailwindcss.com/docs/space
         */
        "space-x-reverse": ["space-x-reverse"],
        /**
         * Space Between Y
         * @see https://tailwindcss.com/docs/space
         */
        "space-y": [{
          "space-y": [space]
        }],
        /**
         * Space Between Y Reverse
         * @see https://tailwindcss.com/docs/space
         */
        "space-y-reverse": ["space-y-reverse"],
        // Sizing
        /**
         * Width
         * @see https://tailwindcss.com/docs/width
         */
        w: [{
          w: ["auto", "min", "max", "fit", "svw", "lvw", "dvw", isArbitraryValue, spacing]
        }],
        /**
         * Min-Width
         * @see https://tailwindcss.com/docs/min-width
         */
        "min-w": [{
          "min-w": [isArbitraryValue, spacing, "min", "max", "fit"]
        }],
        /**
         * Max-Width
         * @see https://tailwindcss.com/docs/max-width
         */
        "max-w": [{
          "max-w": [isArbitraryValue, spacing, "none", "full", "min", "max", "fit", "prose", {
            screen: [isTshirtSize]
          }, isTshirtSize]
        }],
        /**
         * Height
         * @see https://tailwindcss.com/docs/height
         */
        h: [{
          h: [isArbitraryValue, spacing, "auto", "min", "max", "fit", "svh", "lvh", "dvh"]
        }],
        /**
         * Min-Height
         * @see https://tailwindcss.com/docs/min-height
         */
        "min-h": [{
          "min-h": [isArbitraryValue, spacing, "min", "max", "fit", "svh", "lvh", "dvh"]
        }],
        /**
         * Max-Height
         * @see https://tailwindcss.com/docs/max-height
         */
        "max-h": [{
          "max-h": [isArbitraryValue, spacing, "min", "max", "fit", "svh", "lvh", "dvh"]
        }],
        /**
         * Size
         * @see https://tailwindcss.com/docs/size
         */
        size: [{
          size: [isArbitraryValue, spacing, "auto", "min", "max", "fit"]
        }],
        // Typography
        /**
         * Font Size
         * @see https://tailwindcss.com/docs/font-size
         */
        "font-size": [{
          text: ["base", isTshirtSize, isArbitraryLength]
        }],
        /**
         * Font Smoothing
         * @see https://tailwindcss.com/docs/font-smoothing
         */
        "font-smoothing": ["antialiased", "subpixel-antialiased"],
        /**
         * Font Style
         * @see https://tailwindcss.com/docs/font-style
         */
        "font-style": ["italic", "not-italic"],
        /**
         * Font Weight
         * @see https://tailwindcss.com/docs/font-weight
         */
        "font-weight": [{
          font: ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black", isArbitraryNumber]
        }],
        /**
         * Font Family
         * @see https://tailwindcss.com/docs/font-family
         */
        "font-family": [{
          font: [isAny]
        }],
        /**
         * Font Variant Numeric
         * @see https://tailwindcss.com/docs/font-variant-numeric
         */
        "fvn-normal": ["normal-nums"],
        /**
         * Font Variant Numeric
         * @see https://tailwindcss.com/docs/font-variant-numeric
         */
        "fvn-ordinal": ["ordinal"],
        /**
         * Font Variant Numeric
         * @see https://tailwindcss.com/docs/font-variant-numeric
         */
        "fvn-slashed-zero": ["slashed-zero"],
        /**
         * Font Variant Numeric
         * @see https://tailwindcss.com/docs/font-variant-numeric
         */
        "fvn-figure": ["lining-nums", "oldstyle-nums"],
        /**
         * Font Variant Numeric
         * @see https://tailwindcss.com/docs/font-variant-numeric
         */
        "fvn-spacing": ["proportional-nums", "tabular-nums"],
        /**
         * Font Variant Numeric
         * @see https://tailwindcss.com/docs/font-variant-numeric
         */
        "fvn-fraction": ["diagonal-fractions", "stacked-fractons"],
        /**
         * Letter Spacing
         * @see https://tailwindcss.com/docs/letter-spacing
         */
        tracking: [{
          tracking: ["tighter", "tight", "normal", "wide", "wider", "widest", isArbitraryValue]
        }],
        /**
         * Line Clamp
         * @see https://tailwindcss.com/docs/line-clamp
         */
        "line-clamp": [{
          "line-clamp": ["none", isNumber, isArbitraryNumber]
        }],
        /**
         * Line Height
         * @see https://tailwindcss.com/docs/line-height
         */
        leading: [{
          leading: ["none", "tight", "snug", "normal", "relaxed", "loose", isLength, isArbitraryValue]
        }],
        /**
         * List Style Image
         * @see https://tailwindcss.com/docs/list-style-image
         */
        "list-image": [{
          "list-image": ["none", isArbitraryValue]
        }],
        /**
         * List Style Type
         * @see https://tailwindcss.com/docs/list-style-type
         */
        "list-style-type": [{
          list: ["none", "disc", "decimal", isArbitraryValue]
        }],
        /**
         * List Style Position
         * @see https://tailwindcss.com/docs/list-style-position
         */
        "list-style-position": [{
          list: ["inside", "outside"]
        }],
        /**
         * Placeholder Color
         * @deprecated since Tailwind CSS v3.0.0
         * @see https://tailwindcss.com/docs/placeholder-color
         */
        "placeholder-color": [{
          placeholder: [colors]
        }],
        /**
         * Placeholder Opacity
         * @see https://tailwindcss.com/docs/placeholder-opacity
         */
        "placeholder-opacity": [{
          "placeholder-opacity": [opacity]
        }],
        /**
         * Text Alignment
         * @see https://tailwindcss.com/docs/text-align
         */
        "text-alignment": [{
          text: ["left", "center", "right", "justify", "start", "end"]
        }],
        /**
         * Text Color
         * @see https://tailwindcss.com/docs/text-color
         */
        "text-color": [{
          text: [colors]
        }],
        /**
         * Text Opacity
         * @see https://tailwindcss.com/docs/text-opacity
         */
        "text-opacity": [{
          "text-opacity": [opacity]
        }],
        /**
         * Text Decoration
         * @see https://tailwindcss.com/docs/text-decoration
         */
        "text-decoration": ["underline", "overline", "line-through", "no-underline"],
        /**
         * Text Decoration Style
         * @see https://tailwindcss.com/docs/text-decoration-style
         */
        "text-decoration-style": [{
          decoration: [...getLineStyles(), "wavy"]
        }],
        /**
         * Text Decoration Thickness
         * @see https://tailwindcss.com/docs/text-decoration-thickness
         */
        "text-decoration-thickness": [{
          decoration: ["auto", "from-font", isLength, isArbitraryLength]
        }],
        /**
         * Text Underline Offset
         * @see https://tailwindcss.com/docs/text-underline-offset
         */
        "underline-offset": [{
          "underline-offset": ["auto", isLength, isArbitraryValue]
        }],
        /**
         * Text Decoration Color
         * @see https://tailwindcss.com/docs/text-decoration-color
         */
        "text-decoration-color": [{
          decoration: [colors]
        }],
        /**
         * Text Transform
         * @see https://tailwindcss.com/docs/text-transform
         */
        "text-transform": ["uppercase", "lowercase", "capitalize", "normal-case"],
        /**
         * Text Overflow
         * @see https://tailwindcss.com/docs/text-overflow
         */
        "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
        /**
         * Text Wrap
         * @see https://tailwindcss.com/docs/text-wrap
         */
        "text-wrap": [{
          text: ["wrap", "nowrap", "balance", "pretty"]
        }],
        /**
         * Text Indent
         * @see https://tailwindcss.com/docs/text-indent
         */
        indent: [{
          indent: getSpacingWithArbitrary()
        }],
        /**
         * Vertical Alignment
         * @see https://tailwindcss.com/docs/vertical-align
         */
        "vertical-align": [{
          align: ["baseline", "top", "middle", "bottom", "text-top", "text-bottom", "sub", "super", isArbitraryValue]
        }],
        /**
         * Whitespace
         * @see https://tailwindcss.com/docs/whitespace
         */
        whitespace: [{
          whitespace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"]
        }],
        /**
         * Word Break
         * @see https://tailwindcss.com/docs/word-break
         */
        break: [{
          break: ["normal", "words", "all", "keep"]
        }],
        /**
         * Hyphens
         * @see https://tailwindcss.com/docs/hyphens
         */
        hyphens: [{
          hyphens: ["none", "manual", "auto"]
        }],
        /**
         * Content
         * @see https://tailwindcss.com/docs/content
         */
        content: [{
          content: ["none", isArbitraryValue]
        }],
        // Backgrounds
        /**
         * Background Attachment
         * @see https://tailwindcss.com/docs/background-attachment
         */
        "bg-attachment": [{
          bg: ["fixed", "local", "scroll"]
        }],
        /**
         * Background Clip
         * @see https://tailwindcss.com/docs/background-clip
         */
        "bg-clip": [{
          "bg-clip": ["border", "padding", "content", "text"]
        }],
        /**
         * Background Opacity
         * @deprecated since Tailwind CSS v3.0.0
         * @see https://tailwindcss.com/docs/background-opacity
         */
        "bg-opacity": [{
          "bg-opacity": [opacity]
        }],
        /**
         * Background Origin
         * @see https://tailwindcss.com/docs/background-origin
         */
        "bg-origin": [{
          "bg-origin": ["border", "padding", "content"]
        }],
        /**
         * Background Position
         * @see https://tailwindcss.com/docs/background-position
         */
        "bg-position": [{
          bg: [...getPositions(), isArbitraryPosition]
        }],
        /**
         * Background Repeat
         * @see https://tailwindcss.com/docs/background-repeat
         */
        "bg-repeat": [{
          bg: ["no-repeat", {
            repeat: ["", "x", "y", "round", "space"]
          }]
        }],
        /**
         * Background Size
         * @see https://tailwindcss.com/docs/background-size
         */
        "bg-size": [{
          bg: ["auto", "cover", "contain", isArbitrarySize]
        }],
        /**
         * Background Image
         * @see https://tailwindcss.com/docs/background-image
         */
        "bg-image": [{
          bg: ["none", {
            "gradient-to": ["t", "tr", "r", "br", "b", "bl", "l", "tl"]
          }, isArbitraryImage]
        }],
        /**
         * Background Color
         * @see https://tailwindcss.com/docs/background-color
         */
        "bg-color": [{
          bg: [colors]
        }],
        /**
         * Gradient Color Stops From Position
         * @see https://tailwindcss.com/docs/gradient-color-stops
         */
        "gradient-from-pos": [{
          from: [gradientColorStopPositions]
        }],
        /**
         * Gradient Color Stops Via Position
         * @see https://tailwindcss.com/docs/gradient-color-stops
         */
        "gradient-via-pos": [{
          via: [gradientColorStopPositions]
        }],
        /**
         * Gradient Color Stops To Position
         * @see https://tailwindcss.com/docs/gradient-color-stops
         */
        "gradient-to-pos": [{
          to: [gradientColorStopPositions]
        }],
        /**
         * Gradient Color Stops From
         * @see https://tailwindcss.com/docs/gradient-color-stops
         */
        "gradient-from": [{
          from: [gradientColorStops]
        }],
        /**
         * Gradient Color Stops Via
         * @see https://tailwindcss.com/docs/gradient-color-stops
         */
        "gradient-via": [{
          via: [gradientColorStops]
        }],
        /**
         * Gradient Color Stops To
         * @see https://tailwindcss.com/docs/gradient-color-stops
         */
        "gradient-to": [{
          to: [gradientColorStops]
        }],
        // Borders
        /**
         * Border Radius
         * @see https://tailwindcss.com/docs/border-radius
         */
        rounded: [{
          rounded: [borderRadius]
        }],
        /**
         * Border Radius Start
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-s": [{
          "rounded-s": [borderRadius]
        }],
        /**
         * Border Radius End
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-e": [{
          "rounded-e": [borderRadius]
        }],
        /**
         * Border Radius Top
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-t": [{
          "rounded-t": [borderRadius]
        }],
        /**
         * Border Radius Right
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-r": [{
          "rounded-r": [borderRadius]
        }],
        /**
         * Border Radius Bottom
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-b": [{
          "rounded-b": [borderRadius]
        }],
        /**
         * Border Radius Left
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-l": [{
          "rounded-l": [borderRadius]
        }],
        /**
         * Border Radius Start Start
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-ss": [{
          "rounded-ss": [borderRadius]
        }],
        /**
         * Border Radius Start End
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-se": [{
          "rounded-se": [borderRadius]
        }],
        /**
         * Border Radius End End
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-ee": [{
          "rounded-ee": [borderRadius]
        }],
        /**
         * Border Radius End Start
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-es": [{
          "rounded-es": [borderRadius]
        }],
        /**
         * Border Radius Top Left
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-tl": [{
          "rounded-tl": [borderRadius]
        }],
        /**
         * Border Radius Top Right
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-tr": [{
          "rounded-tr": [borderRadius]
        }],
        /**
         * Border Radius Bottom Right
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-br": [{
          "rounded-br": [borderRadius]
        }],
        /**
         * Border Radius Bottom Left
         * @see https://tailwindcss.com/docs/border-radius
         */
        "rounded-bl": [{
          "rounded-bl": [borderRadius]
        }],
        /**
         * Border Width
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w": [{
          border: [borderWidth]
        }],
        /**
         * Border Width X
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-x": [{
          "border-x": [borderWidth]
        }],
        /**
         * Border Width Y
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-y": [{
          "border-y": [borderWidth]
        }],
        /**
         * Border Width Start
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-s": [{
          "border-s": [borderWidth]
        }],
        /**
         * Border Width End
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-e": [{
          "border-e": [borderWidth]
        }],
        /**
         * Border Width Top
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-t": [{
          "border-t": [borderWidth]
        }],
        /**
         * Border Width Right
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-r": [{
          "border-r": [borderWidth]
        }],
        /**
         * Border Width Bottom
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-b": [{
          "border-b": [borderWidth]
        }],
        /**
         * Border Width Left
         * @see https://tailwindcss.com/docs/border-width
         */
        "border-w-l": [{
          "border-l": [borderWidth]
        }],
        /**
         * Border Opacity
         * @see https://tailwindcss.com/docs/border-opacity
         */
        "border-opacity": [{
          "border-opacity": [opacity]
        }],
        /**
         * Border Style
         * @see https://tailwindcss.com/docs/border-style
         */
        "border-style": [{
          border: [...getLineStyles(), "hidden"]
        }],
        /**
         * Divide Width X
         * @see https://tailwindcss.com/docs/divide-width
         */
        "divide-x": [{
          "divide-x": [borderWidth]
        }],
        /**
         * Divide Width X Reverse
         * @see https://tailwindcss.com/docs/divide-width
         */
        "divide-x-reverse": ["divide-x-reverse"],
        /**
         * Divide Width Y
         * @see https://tailwindcss.com/docs/divide-width
         */
        "divide-y": [{
          "divide-y": [borderWidth]
        }],
        /**
         * Divide Width Y Reverse
         * @see https://tailwindcss.com/docs/divide-width
         */
        "divide-y-reverse": ["divide-y-reverse"],
        /**
         * Divide Opacity
         * @see https://tailwindcss.com/docs/divide-opacity
         */
        "divide-opacity": [{
          "divide-opacity": [opacity]
        }],
        /**
         * Divide Style
         * @see https://tailwindcss.com/docs/divide-style
         */
        "divide-style": [{
          divide: getLineStyles()
        }],
        /**
         * Border Color
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color": [{
          border: [borderColor]
        }],
        /**
         * Border Color X
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-x": [{
          "border-x": [borderColor]
        }],
        /**
         * Border Color Y
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-y": [{
          "border-y": [borderColor]
        }],
        /**
         * Border Color S
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-s": [{
          "border-s": [borderColor]
        }],
        /**
         * Border Color E
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-e": [{
          "border-e": [borderColor]
        }],
        /**
         * Border Color Top
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-t": [{
          "border-t": [borderColor]
        }],
        /**
         * Border Color Right
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-r": [{
          "border-r": [borderColor]
        }],
        /**
         * Border Color Bottom
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-b": [{
          "border-b": [borderColor]
        }],
        /**
         * Border Color Left
         * @see https://tailwindcss.com/docs/border-color
         */
        "border-color-l": [{
          "border-l": [borderColor]
        }],
        /**
         * Divide Color
         * @see https://tailwindcss.com/docs/divide-color
         */
        "divide-color": [{
          divide: [borderColor]
        }],
        /**
         * Outline Style
         * @see https://tailwindcss.com/docs/outline-style
         */
        "outline-style": [{
          outline: ["", ...getLineStyles()]
        }],
        /**
         * Outline Offset
         * @see https://tailwindcss.com/docs/outline-offset
         */
        "outline-offset": [{
          "outline-offset": [isLength, isArbitraryValue]
        }],
        /**
         * Outline Width
         * @see https://tailwindcss.com/docs/outline-width
         */
        "outline-w": [{
          outline: [isLength, isArbitraryLength]
        }],
        /**
         * Outline Color
         * @see https://tailwindcss.com/docs/outline-color
         */
        "outline-color": [{
          outline: [colors]
        }],
        /**
         * Ring Width
         * @see https://tailwindcss.com/docs/ring-width
         */
        "ring-w": [{
          ring: getLengthWithEmptyAndArbitrary()
        }],
        /**
         * Ring Width Inset
         * @see https://tailwindcss.com/docs/ring-width
         */
        "ring-w-inset": ["ring-inset"],
        /**
         * Ring Color
         * @see https://tailwindcss.com/docs/ring-color
         */
        "ring-color": [{
          ring: [colors]
        }],
        /**
         * Ring Opacity
         * @see https://tailwindcss.com/docs/ring-opacity
         */
        "ring-opacity": [{
          "ring-opacity": [opacity]
        }],
        /**
         * Ring Offset Width
         * @see https://tailwindcss.com/docs/ring-offset-width
         */
        "ring-offset-w": [{
          "ring-offset": [isLength, isArbitraryLength]
        }],
        /**
         * Ring Offset Color
         * @see https://tailwindcss.com/docs/ring-offset-color
         */
        "ring-offset-color": [{
          "ring-offset": [colors]
        }],
        // Effects
        /**
         * Box Shadow
         * @see https://tailwindcss.com/docs/box-shadow
         */
        shadow: [{
          shadow: ["", "inner", "none", isTshirtSize, isArbitraryShadow]
        }],
        /**
         * Box Shadow Color
         * @see https://tailwindcss.com/docs/box-shadow-color
         */
        "shadow-color": [{
          shadow: [isAny]
        }],
        /**
         * Opacity
         * @see https://tailwindcss.com/docs/opacity
         */
        opacity: [{
          opacity: [opacity]
        }],
        /**
         * Mix Blend Mode
         * @see https://tailwindcss.com/docs/mix-blend-mode
         */
        "mix-blend": [{
          "mix-blend": [...getBlendModes(), "plus-lighter", "plus-darker"]
        }],
        /**
         * Background Blend Mode
         * @see https://tailwindcss.com/docs/background-blend-mode
         */
        "bg-blend": [{
          "bg-blend": getBlendModes()
        }],
        // Filters
        /**
         * Filter
         * @deprecated since Tailwind CSS v3.0.0
         * @see https://tailwindcss.com/docs/filter
         */
        filter: [{
          filter: ["", "none"]
        }],
        /**
         * Blur
         * @see https://tailwindcss.com/docs/blur
         */
        blur: [{
          blur: [blur]
        }],
        /**
         * Brightness
         * @see https://tailwindcss.com/docs/brightness
         */
        brightness: [{
          brightness: [brightness]
        }],
        /**
         * Contrast
         * @see https://tailwindcss.com/docs/contrast
         */
        contrast: [{
          contrast: [contrast]
        }],
        /**
         * Drop Shadow
         * @see https://tailwindcss.com/docs/drop-shadow
         */
        "drop-shadow": [{
          "drop-shadow": ["", "none", isTshirtSize, isArbitraryValue]
        }],
        /**
         * Grayscale
         * @see https://tailwindcss.com/docs/grayscale
         */
        grayscale: [{
          grayscale: [grayscale]
        }],
        /**
         * Hue Rotate
         * @see https://tailwindcss.com/docs/hue-rotate
         */
        "hue-rotate": [{
          "hue-rotate": [hueRotate]
        }],
        /**
         * Invert
         * @see https://tailwindcss.com/docs/invert
         */
        invert: [{
          invert: [invert]
        }],
        /**
         * Saturate
         * @see https://tailwindcss.com/docs/saturate
         */
        saturate: [{
          saturate: [saturate]
        }],
        /**
         * Sepia
         * @see https://tailwindcss.com/docs/sepia
         */
        sepia: [{
          sepia: [sepia]
        }],
        /**
         * Backdrop Filter
         * @deprecated since Tailwind CSS v3.0.0
         * @see https://tailwindcss.com/docs/backdrop-filter
         */
        "backdrop-filter": [{
          "backdrop-filter": ["", "none"]
        }],
        /**
         * Backdrop Blur
         * @see https://tailwindcss.com/docs/backdrop-blur
         */
        "backdrop-blur": [{
          "backdrop-blur": [blur]
        }],
        /**
         * Backdrop Brightness
         * @see https://tailwindcss.com/docs/backdrop-brightness
         */
        "backdrop-brightness": [{
          "backdrop-brightness": [brightness]
        }],
        /**
         * Backdrop Contrast
         * @see https://tailwindcss.com/docs/backdrop-contrast
         */
        "backdrop-contrast": [{
          "backdrop-contrast": [contrast]
        }],
        /**
         * Backdrop Grayscale
         * @see https://tailwindcss.com/docs/backdrop-grayscale
         */
        "backdrop-grayscale": [{
          "backdrop-grayscale": [grayscale]
        }],
        /**
         * Backdrop Hue Rotate
         * @see https://tailwindcss.com/docs/backdrop-hue-rotate
         */
        "backdrop-hue-rotate": [{
          "backdrop-hue-rotate": [hueRotate]
        }],
        /**
         * Backdrop Invert
         * @see https://tailwindcss.com/docs/backdrop-invert
         */
        "backdrop-invert": [{
          "backdrop-invert": [invert]
        }],
        /**
         * Backdrop Opacity
         * @see https://tailwindcss.com/docs/backdrop-opacity
         */
        "backdrop-opacity": [{
          "backdrop-opacity": [opacity]
        }],
        /**
         * Backdrop Saturate
         * @see https://tailwindcss.com/docs/backdrop-saturate
         */
        "backdrop-saturate": [{
          "backdrop-saturate": [saturate]
        }],
        /**
         * Backdrop Sepia
         * @see https://tailwindcss.com/docs/backdrop-sepia
         */
        "backdrop-sepia": [{
          "backdrop-sepia": [sepia]
        }],
        // Tables
        /**
         * Border Collapse
         * @see https://tailwindcss.com/docs/border-collapse
         */
        "border-collapse": [{
          border: ["collapse", "separate"]
        }],
        /**
         * Border Spacing
         * @see https://tailwindcss.com/docs/border-spacing
         */
        "border-spacing": [{
          "border-spacing": [borderSpacing]
        }],
        /**
         * Border Spacing X
         * @see https://tailwindcss.com/docs/border-spacing
         */
        "border-spacing-x": [{
          "border-spacing-x": [borderSpacing]
        }],
        /**
         * Border Spacing Y
         * @see https://tailwindcss.com/docs/border-spacing
         */
        "border-spacing-y": [{
          "border-spacing-y": [borderSpacing]
        }],
        /**
         * Table Layout
         * @see https://tailwindcss.com/docs/table-layout
         */
        "table-layout": [{
          table: ["auto", "fixed"]
        }],
        /**
         * Caption Side
         * @see https://tailwindcss.com/docs/caption-side
         */
        caption: [{
          caption: ["top", "bottom"]
        }],
        // Transitions and Animation
        /**
         * Tranisition Property
         * @see https://tailwindcss.com/docs/transition-property
         */
        transition: [{
          transition: ["none", "all", "", "colors", "opacity", "shadow", "transform", isArbitraryValue]
        }],
        /**
         * Transition Duration
         * @see https://tailwindcss.com/docs/transition-duration
         */
        duration: [{
          duration: getNumberAndArbitrary()
        }],
        /**
         * Transition Timing Function
         * @see https://tailwindcss.com/docs/transition-timing-function
         */
        ease: [{
          ease: ["linear", "in", "out", "in-out", isArbitraryValue]
        }],
        /**
         * Transition Delay
         * @see https://tailwindcss.com/docs/transition-delay
         */
        delay: [{
          delay: getNumberAndArbitrary()
        }],
        /**
         * Animation
         * @see https://tailwindcss.com/docs/animation
         */
        animate: [{
          animate: ["none", "spin", "ping", "pulse", "bounce", isArbitraryValue]
        }],
        // Transforms
        /**
         * Transform
         * @see https://tailwindcss.com/docs/transform
         */
        transform: [{
          transform: ["", "gpu", "none"]
        }],
        /**
         * Scale
         * @see https://tailwindcss.com/docs/scale
         */
        scale: [{
          scale: [scale]
        }],
        /**
         * Scale X
         * @see https://tailwindcss.com/docs/scale
         */
        "scale-x": [{
          "scale-x": [scale]
        }],
        /**
         * Scale Y
         * @see https://tailwindcss.com/docs/scale
         */
        "scale-y": [{
          "scale-y": [scale]
        }],
        /**
         * Rotate
         * @see https://tailwindcss.com/docs/rotate
         */
        rotate: [{
          rotate: [isInteger, isArbitraryValue]
        }],
        /**
         * Translate X
         * @see https://tailwindcss.com/docs/translate
         */
        "translate-x": [{
          "translate-x": [translate]
        }],
        /**
         * Translate Y
         * @see https://tailwindcss.com/docs/translate
         */
        "translate-y": [{
          "translate-y": [translate]
        }],
        /**
         * Skew X
         * @see https://tailwindcss.com/docs/skew
         */
        "skew-x": [{
          "skew-x": [skew]
        }],
        /**
         * Skew Y
         * @see https://tailwindcss.com/docs/skew
         */
        "skew-y": [{
          "skew-y": [skew]
        }],
        /**
         * Transform Origin
         * @see https://tailwindcss.com/docs/transform-origin
         */
        "transform-origin": [{
          origin: ["center", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left", isArbitraryValue]
        }],
        // Interactivity
        /**
         * Accent Color
         * @see https://tailwindcss.com/docs/accent-color
         */
        accent: [{
          accent: ["auto", colors]
        }],
        /**
         * Appearance
         * @see https://tailwindcss.com/docs/appearance
         */
        appearance: [{
          appearance: ["none", "auto"]
        }],
        /**
         * Cursor
         * @see https://tailwindcss.com/docs/cursor
         */
        cursor: [{
          cursor: ["auto", "default", "pointer", "wait", "text", "move", "help", "not-allowed", "none", "context-menu", "progress", "cell", "crosshair", "vertical-text", "alias", "copy", "no-drop", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out", isArbitraryValue]
        }],
        /**
         * Caret Color
         * @see https://tailwindcss.com/docs/just-in-time-mode#caret-color-utilities
         */
        "caret-color": [{
          caret: [colors]
        }],
        /**
         * Pointer Events
         * @see https://tailwindcss.com/docs/pointer-events
         */
        "pointer-events": [{
          "pointer-events": ["none", "auto"]
        }],
        /**
         * Resize
         * @see https://tailwindcss.com/docs/resize
         */
        resize: [{
          resize: ["none", "y", "x", ""]
        }],
        /**
         * Scroll Behavior
         * @see https://tailwindcss.com/docs/scroll-behavior
         */
        "scroll-behavior": [{
          scroll: ["auto", "smooth"]
        }],
        /**
         * Scroll Margin
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-m": [{
          "scroll-m": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin X
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-mx": [{
          "scroll-mx": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin Y
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-my": [{
          "scroll-my": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin Start
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-ms": [{
          "scroll-ms": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin End
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-me": [{
          "scroll-me": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin Top
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-mt": [{
          "scroll-mt": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin Right
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-mr": [{
          "scroll-mr": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin Bottom
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-mb": [{
          "scroll-mb": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Margin Left
         * @see https://tailwindcss.com/docs/scroll-margin
         */
        "scroll-ml": [{
          "scroll-ml": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-p": [{
          "scroll-p": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding X
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-px": [{
          "scroll-px": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding Y
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-py": [{
          "scroll-py": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding Start
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-ps": [{
          "scroll-ps": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding End
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-pe": [{
          "scroll-pe": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding Top
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-pt": [{
          "scroll-pt": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding Right
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-pr": [{
          "scroll-pr": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding Bottom
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-pb": [{
          "scroll-pb": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Padding Left
         * @see https://tailwindcss.com/docs/scroll-padding
         */
        "scroll-pl": [{
          "scroll-pl": getSpacingWithArbitrary()
        }],
        /**
         * Scroll Snap Align
         * @see https://tailwindcss.com/docs/scroll-snap-align
         */
        "snap-align": [{
          snap: ["start", "end", "center", "align-none"]
        }],
        /**
         * Scroll Snap Stop
         * @see https://tailwindcss.com/docs/scroll-snap-stop
         */
        "snap-stop": [{
          snap: ["normal", "always"]
        }],
        /**
         * Scroll Snap Type
         * @see https://tailwindcss.com/docs/scroll-snap-type
         */
        "snap-type": [{
          snap: ["none", "x", "y", "both"]
        }],
        /**
         * Scroll Snap Type Strictness
         * @see https://tailwindcss.com/docs/scroll-snap-type
         */
        "snap-strictness": [{
          snap: ["mandatory", "proximity"]
        }],
        /**
         * Touch Action
         * @see https://tailwindcss.com/docs/touch-action
         */
        touch: [{
          touch: ["auto", "none", "manipulation"]
        }],
        /**
         * Touch Action X
         * @see https://tailwindcss.com/docs/touch-action
         */
        "touch-x": [{
          "touch-pan": ["x", "left", "right"]
        }],
        /**
         * Touch Action Y
         * @see https://tailwindcss.com/docs/touch-action
         */
        "touch-y": [{
          "touch-pan": ["y", "up", "down"]
        }],
        /**
         * Touch Action Pinch Zoom
         * @see https://tailwindcss.com/docs/touch-action
         */
        "touch-pz": ["touch-pinch-zoom"],
        /**
         * User Select
         * @see https://tailwindcss.com/docs/user-select
         */
        select: [{
          select: ["none", "text", "all", "auto"]
        }],
        /**
         * Will Change
         * @see https://tailwindcss.com/docs/will-change
         */
        "will-change": [{
          "will-change": ["auto", "scroll", "contents", "transform", isArbitraryValue]
        }],
        // SVG
        /**
         * Fill
         * @see https://tailwindcss.com/docs/fill
         */
        fill: [{
          fill: [colors, "none"]
        }],
        /**
         * Stroke Width
         * @see https://tailwindcss.com/docs/stroke-width
         */
        "stroke-w": [{
          stroke: [isLength, isArbitraryLength, isArbitraryNumber]
        }],
        /**
         * Stroke
         * @see https://tailwindcss.com/docs/stroke
         */
        stroke: [{
          stroke: [colors, "none"]
        }],
        // Accessibility
        /**
         * Screen Readers
         * @see https://tailwindcss.com/docs/screen-readers
         */
        sr: ["sr-only", "not-sr-only"],
        /**
         * Forced Color Adjust
         * @see https://tailwindcss.com/docs/forced-color-adjust
         */
        "forced-color-adjust": [{
          "forced-color-adjust": ["auto", "none"]
        }]
      },
      conflictingClassGroups: {
        overflow: ["overflow-x", "overflow-y"],
        overscroll: ["overscroll-x", "overscroll-y"],
        inset: ["inset-x", "inset-y", "start", "end", "top", "right", "bottom", "left"],
        "inset-x": ["right", "left"],
        "inset-y": ["top", "bottom"],
        flex: ["basis", "grow", "shrink"],
        gap: ["gap-x", "gap-y"],
        p: ["px", "py", "ps", "pe", "pt", "pr", "pb", "pl"],
        px: ["pr", "pl"],
        py: ["pt", "pb"],
        m: ["mx", "my", "ms", "me", "mt", "mr", "mb", "ml"],
        mx: ["mr", "ml"],
        my: ["mt", "mb"],
        size: ["w", "h"],
        "font-size": ["leading"],
        "fvn-normal": ["fvn-ordinal", "fvn-slashed-zero", "fvn-figure", "fvn-spacing", "fvn-fraction"],
        "fvn-ordinal": ["fvn-normal"],
        "fvn-slashed-zero": ["fvn-normal"],
        "fvn-figure": ["fvn-normal"],
        "fvn-spacing": ["fvn-normal"],
        "fvn-fraction": ["fvn-normal"],
        "line-clamp": ["display", "overflow"],
        rounded: ["rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded-ss", "rounded-se", "rounded-ee", "rounded-es", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
        "rounded-s": ["rounded-ss", "rounded-es"],
        "rounded-e": ["rounded-se", "rounded-ee"],
        "rounded-t": ["rounded-tl", "rounded-tr"],
        "rounded-r": ["rounded-tr", "rounded-br"],
        "rounded-b": ["rounded-br", "rounded-bl"],
        "rounded-l": ["rounded-tl", "rounded-bl"],
        "border-spacing": ["border-spacing-x", "border-spacing-y"],
        "border-w": ["border-w-s", "border-w-e", "border-w-t", "border-w-r", "border-w-b", "border-w-l"],
        "border-w-x": ["border-w-r", "border-w-l"],
        "border-w-y": ["border-w-t", "border-w-b"],
        "border-color": ["border-color-s", "border-color-e", "border-color-t", "border-color-r", "border-color-b", "border-color-l"],
        "border-color-x": ["border-color-r", "border-color-l"],
        "border-color-y": ["border-color-t", "border-color-b"],
        "scroll-m": ["scroll-mx", "scroll-my", "scroll-ms", "scroll-me", "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml"],
        "scroll-mx": ["scroll-mr", "scroll-ml"],
        "scroll-my": ["scroll-mt", "scroll-mb"],
        "scroll-p": ["scroll-px", "scroll-py", "scroll-ps", "scroll-pe", "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl"],
        "scroll-px": ["scroll-pr", "scroll-pl"],
        "scroll-py": ["scroll-pt", "scroll-pb"],
        touch: ["touch-x", "touch-y", "touch-pz"],
        "touch-x": ["touch"],
        "touch-y": ["touch"],
        "touch-pz": ["touch"]
      },
      conflictingClassGroupModifiers: {
        "font-size": ["leading"]
      }
    };
  };
  var twMerge = /* @__PURE__ */ createTailwindMerge(getDefaultConfig);

  // ../stack-ui/dist/esm/lib/utils.js
  function cn(...inputs) {
    return twMerge(clsx(inputs));
  }

  // ../stack-shared/dist/esm/utils/react.js
  var import_react3 = __toESM(require_react());

  // ../stack-shared/dist/esm/utils/results.js
  var Result = {
    fromThrowing,
    fromThrowingAsync,
    fromPromise: promiseToResult,
    ok(data) {
      return {
        status: "ok",
        data
      };
    },
    error(error) {
      return {
        status: "error",
        error
      };
    },
    map: mapResult,
    or: (result, fallback) => {
      return result.status === "ok" ? result.data : fallback;
    },
    orThrow: (result) => {
      if (result.status === "error") throw result.error;
      return result.data;
    },
    orThrowAsync: async (result) => {
      return Result.orThrow(await result);
    },
    retry
  };
  var AsyncResult = {
    fromThrowing,
    fromPromise: promiseToResult,
    ok: Result.ok,
    error: Result.error,
    pending: pending$1,
    map: mapResult,
    or: (result, fallback) => {
      if (result.status === "pending") return fallback;
      return Result.or(result, fallback);
    },
    orThrow: (result) => {
      if (result.status === "pending") throw new Error("Result still pending");
      return Result.orThrow(result);
    },
    retry
  };
  function pending$1(progress) {
    return {
      status: "pending",
      progress
    };
  }
  async function promiseToResult(promise) {
    try {
      const value = await promise;
      return Result.ok(value);
    } catch (error) {
      return Result.error(error);
    }
  }
  function fromThrowing(fn) {
    try {
      return Result.ok(fn());
    } catch (error) {
      return Result.error(error);
    }
  }
  async function fromThrowingAsync(fn) {
    try {
      return Result.ok(await fn());
    } catch (error) {
      return Result.error(error);
    }
  }
  function mapResult(result, fn) {
    if (result.status === "error") return {
      status: "error",
      error: result.error
    };
    if (result.status === "pending") return {
      status: "pending",
      ..."progress" in result ? { progress: result.progress } : {}
    };
    return Result.ok(fn(result.data));
  }
  var RetryError = class extends AggregateError {
    constructor(errors) {
      const strings = errors.map((e15) => nicify(e15));
      const isAllSame = strings.length > 1 && strings.every((s4) => s4 === strings[0]);
      super(errors, deindent`
      Error after ${errors.length} attempts.
      
      ${isAllSame ? deindent`
        Attempts 1-${errors.length}:
          ${strings[0]}
      ` : strings.map((s4, i) => deindent`
          Attempt ${i + 1}:
            ${s4}
        `).join("\n\n")}
      `, { cause: errors[errors.length - 1] });
      this.errors = errors;
      this.name = "RetryError";
    }
    get attempts() {
      return this.errors.length;
    }
  };
  RetryError.prototype.name = "RetryError";
  async function retry(fn, totalAttempts, { exponentialDelayBase = 1e3 } = {}) {
    const errors = [];
    for (let i = 0; i < totalAttempts; i++) {
      const res = await fn(i);
      if (res.status === "ok") return Object.assign(Result.ok(res.data), { attempts: i + 1 });
      else {
        errors.push(res.error);
        if (i < totalAttempts - 1) await wait((Math.random() + 0.5) * exponentialDelayBase * 2 ** i);
      }
    }
    return Object.assign(Result.error(new RetryError(errors)), { attempts: totalAttempts });
  }

  // ../stack-shared/dist/esm/known-errors.js
  var KnownError = class extends StatusError {
    constructor(statusCode, humanReadableMessage, details) {
      super(statusCode, humanReadableMessage);
      this.statusCode = statusCode;
      this.humanReadableMessage = humanReadableMessage;
      this.details = details;
      this.__stackKnownErrorBrand = "stack-known-error-brand-sentinel";
      this.name = "KnownError";
    }
    static isKnownError(error) {
      return typeof error === "object" && error !== null && "__stackKnownErrorBrand" in error && error.__stackKnownErrorBrand === "stack-known-error-brand-sentinel";
    }
    getBody() {
      return new TextEncoder().encode(JSON.stringify(this.toDescriptiveJson(), void 0, 2));
    }
    getHeaders() {
      return {
        "Content-Type": ["application/json; charset=utf-8"],
        "X-Stack-Known-Error": [this.errorCode]
      };
    }
    toDescriptiveJson() {
      return {
        code: this.errorCode,
        ...this.details ? { details: this.details } : {},
        error: this.humanReadableMessage
      };
    }
    get errorCode() {
      return this.constructor.errorCode ?? throwErr(`Can't find error code for this KnownError. Is its constructor a KnownErrorConstructor? ${this}`);
    }
    static constructorArgsFromJson(json) {
      return [
        400,
        json.message,
        json
      ];
    }
    static fromJson(json) {
      for (const [_, KnownErrorType] of Object.entries(KnownErrors)) if (json.code === KnownErrorType.prototype.errorCode) return new KnownErrorType(...KnownErrorType.constructorArgsFromJson(json));
      throw new Error(`An error occurred. Please update your version of the Stack Auth SDK. ${json.code}: ${json.message}`);
    }
  };
  function createKnownErrorConstructor(SuperClass, errorCode, create, constructorArgsFromJson) {
    const createFn = create === "inherit" ? identityArgs : create;
    const constructorArgsFromJsonFn = constructorArgsFromJson === "inherit" ? SuperClass.constructorArgsFromJson : constructorArgsFromJson;
    const _KnownErrorImpl = class _KnownErrorImpl extends SuperClass {
      constructor(...args) {
        super(...createFn(...args));
        this.name = `KnownError<${errorCode}>`;
        this.constructorArgs = args;
      }
      static constructorArgsFromJson(json) {
        return constructorArgsFromJsonFn(json.details);
      }
      static isInstance(error) {
        if (!KnownError.isKnownError(error)) return false;
        let current = error;
        while (true) {
          current = Object.getPrototypeOf(current);
          if (!current) break;
          if ("errorCode" in current.constructor && current.constructor.errorCode === errorCode) return true;
        }
        return false;
      }
    };
    _KnownErrorImpl.errorCode = errorCode;
    let KnownErrorImpl = _KnownErrorImpl;
    return KnownErrorImpl;
  }
  var UnsupportedError = createKnownErrorConstructor(KnownError, "UNSUPPORTED_ERROR", (originalErrorCode) => [
    500,
    `An error occurred that is not currently supported (possibly because it was added in a version of Stack that is newer than this client). The original unsupported error code was: ${originalErrorCode}`,
    { originalErrorCode }
  ], (json) => [json?.originalErrorCode ?? throwErr("originalErrorCode not found in UnsupportedError details")]);
  var BodyParsingError = createKnownErrorConstructor(KnownError, "BODY_PARSING_ERROR", (message) => [400, message], (json) => [json.message]);
  var SchemaError = createKnownErrorConstructor(KnownError, "SCHEMA_ERROR", (message) => [
    400,
    message || throwErr("SchemaError requires a message"),
    { message }
  ], (json) => [json.message]);
  var AllOverloadsFailed = createKnownErrorConstructor(KnownError, "ALL_OVERLOADS_FAILED", (overloadErrors) => [
    400,
    deindent`
      This endpoint has multiple overloads, but they all failed to process the request.

        ${overloadErrors.map((e15, i) => deindent`
          Overload ${i + 1}: ${JSON.stringify(e15, void 0, 2)}
        `).join("\n\n")}
    `,
    { overload_errors: overloadErrors }
  ], (json) => [json?.overload_errors ?? throwErr("overload_errors not found in AllOverloadsFailed details")]);
  var ProjectAuthenticationError = createKnownErrorConstructor(KnownError, "PROJECT_AUTHENTICATION_ERROR", "inherit", "inherit");
  var InvalidProjectAuthentication = createKnownErrorConstructor(ProjectAuthenticationError, "INVALID_PROJECT_AUTHENTICATION", "inherit", "inherit");
  var ProjectKeyWithoutAccessType = createKnownErrorConstructor(InvalidProjectAuthentication, "PROJECT_KEY_WITHOUT_ACCESS_TYPE", () => [400, "Either an API key or an admin access token was provided, but the x-stack-access-type header is missing. Set it to 'client', 'server', or 'admin' as appropriate."], () => []);
  var InvalidAccessType = createKnownErrorConstructor(InvalidProjectAuthentication, "INVALID_ACCESS_TYPE", (accessType) => [400, `The x-stack-access-type header must be 'client', 'server', or 'admin', but was '${accessType}'.`], (json) => [json?.accessType ?? throwErr("accessType not found in InvalidAccessType details")]);
  var AccessTypeWithoutProjectId = createKnownErrorConstructor(InvalidProjectAuthentication, "ACCESS_TYPE_WITHOUT_PROJECT_ID", (accessType) => [
    400,
    deindent`
      The x-stack-access-type header was '${accessType}', but the x-stack-project-id header was not provided.
      
      For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
    `,
    { request_type: accessType }
  ], (json) => [json.request_type]);
  var AccessTypeRequired = createKnownErrorConstructor(InvalidProjectAuthentication, "ACCESS_TYPE_REQUIRED", () => [400, deindent`
      You must specify an access level for this Stack project. Make sure project API keys are provided (eg. x-stack-publishable-client-key) and you set the x-stack-access-type header to 'client', 'server', or 'admin'.
      
      For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
    `], () => []);
  var InsufficientAccessType = createKnownErrorConstructor(InvalidProjectAuthentication, "INSUFFICIENT_ACCESS_TYPE", (actualAccessType, allowedAccessTypes) => [
    401,
    `The x-stack-access-type header must be ${allowedAccessTypes.map((s4) => `'${s4}'`).join(" or ")}, but was '${actualAccessType}'.`,
    {
      actual_access_type: actualAccessType,
      allowed_access_types: allowedAccessTypes
    }
  ], (json) => [json.actual_access_type, json.allowed_access_types]);
  var InvalidPublishableClientKey = createKnownErrorConstructor(InvalidProjectAuthentication, "INVALID_PUBLISHABLE_CLIENT_KEY", (projectId) => [
    401,
    `The publishable key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    { project_id: projectId }
  ], (json) => [json.project_id]);
  var InvalidSecretServerKey = createKnownErrorConstructor(InvalidProjectAuthentication, "INVALID_SECRET_SERVER_KEY", (projectId) => [
    401,
    `The secret server key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    { project_id: projectId }
  ], (json) => [json.project_id]);
  var InvalidSuperSecretAdminKey = createKnownErrorConstructor(InvalidProjectAuthentication, "INVALID_SUPER_SECRET_ADMIN_KEY", (projectId) => [
    401,
    `The super secret admin key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    { project_id: projectId }
  ], (json) => [json.project_id]);
  var InvalidAdminAccessToken = createKnownErrorConstructor(InvalidProjectAuthentication, "INVALID_ADMIN_ACCESS_TOKEN", "inherit", "inherit");
  var UnparsableAdminAccessToken = createKnownErrorConstructor(InvalidAdminAccessToken, "UNPARSABLE_ADMIN_ACCESS_TOKEN", () => [401, "Admin access token is not parsable."], () => []);
  var AdminAccessTokenExpired = createKnownErrorConstructor(InvalidAdminAccessToken, "ADMIN_ACCESS_TOKEN_EXPIRED", (expiredAt) => [
    401,
    `Admin access token has expired. Please refresh it and try again.${expiredAt ? ` (The access token expired at ${expiredAt.toISOString()}.)` : ""}`,
    { expired_at_millis: expiredAt?.getTime() ?? null }
  ], (json) => [json.expired_at_millis ? new Date(json.expired_at_millis) : void 0]);
  var InvalidProjectForAdminAccessToken = createKnownErrorConstructor(InvalidAdminAccessToken, "INVALID_PROJECT_FOR_ADMIN_ACCESS_TOKEN", () => [401, "Admin access tokens must be created on the internal project."], () => []);
  var AdminAccessTokenIsNotAdmin = createKnownErrorConstructor(InvalidAdminAccessToken, "ADMIN_ACCESS_TOKEN_IS_NOT_ADMIN", () => [401, "Admin access token does not have the required permissions to access this project."], () => []);
  var ProjectAuthenticationRequired = createKnownErrorConstructor(ProjectAuthenticationError, "PROJECT_AUTHENTICATION_REQUIRED", "inherit", "inherit");
  var ClientAuthenticationRequired = createKnownErrorConstructor(ProjectAuthenticationRequired, "CLIENT_AUTHENTICATION_REQUIRED", () => [401, "The publishable client key must be provided."], () => []);
  var PublishableClientKeyRequiredForProject = createKnownErrorConstructor(ProjectAuthenticationRequired, "PUBLISHABLE_CLIENT_KEY_REQUIRED_FOR_PROJECT", (projectId) => [
    401,
    "Publishable client keys are required for this project. Create one in Project Keys, or disable this requirement there to allow keyless client access.",
    { project_id: projectId ?? null }
  ], (json) => [json.project_id ?? void 0]);
  var ServerAuthenticationRequired = createKnownErrorConstructor(ProjectAuthenticationRequired, "SERVER_AUTHENTICATION_REQUIRED", () => [401, "The secret server key must be provided."], () => []);
  var ClientOrServerAuthenticationRequired = createKnownErrorConstructor(ProjectAuthenticationRequired, "CLIENT_OR_SERVER_AUTHENTICATION_REQUIRED", () => [401, "Either the publishable client key or the secret server key must be provided."], () => []);
  var ClientOrAdminAuthenticationRequired = createKnownErrorConstructor(ProjectAuthenticationRequired, "CLIENT_OR_ADMIN_AUTHENTICATION_REQUIRED", () => [401, "Either the publishable client key or the super secret admin key must be provided."], () => []);
  var ClientOrServerOrAdminAuthenticationRequired = createKnownErrorConstructor(ProjectAuthenticationRequired, "CLIENT_OR_SERVER_OR_ADMIN_AUTHENTICATION_REQUIRED", () => [401, "Either the publishable client key, the secret server key, or the super secret admin key must be provided."], () => []);
  var AdminAuthenticationRequired = createKnownErrorConstructor(ProjectAuthenticationRequired, "ADMIN_AUTHENTICATION_REQUIRED", () => [401, "The super secret admin key must be provided."], () => []);
  var ExpectedInternalProject = createKnownErrorConstructor(ProjectAuthenticationError, "EXPECTED_INTERNAL_PROJECT", () => [401, "The project ID is expected to be internal."], () => []);
  var SessionAuthenticationError = createKnownErrorConstructor(KnownError, "SESSION_AUTHENTICATION_ERROR", "inherit", "inherit");
  var InvalidSessionAuthentication = createKnownErrorConstructor(SessionAuthenticationError, "INVALID_SESSION_AUTHENTICATION", "inherit", "inherit");
  var InvalidAccessToken = createKnownErrorConstructor(InvalidSessionAuthentication, "INVALID_ACCESS_TOKEN", "inherit", "inherit");
  var UnparsableAccessToken = createKnownErrorConstructor(InvalidAccessToken, "UNPARSABLE_ACCESS_TOKEN", () => [401, "Access token is not parsable."], () => []);
  var AccessTokenExpired = createKnownErrorConstructor(InvalidAccessToken, "ACCESS_TOKEN_EXPIRED", (expiredAt, projectId, userId, refreshTokenId) => [
    401,
    deindent`
      Access token has expired. Please refresh it and try again.${expiredAt ? ` (The access token expired at ${expiredAt.toISOString()}.)` : ""}${projectId ? ` Project ID: ${projectId}.` : ""}${userId ? ` User ID: ${userId}.` : ""}${refreshTokenId ? ` Refresh token ID: ${refreshTokenId}.` : ""}

      Debug info: Most likely, you fetched the access token before it expired (for example, in a server component, pre-rendered page, or on page load), but then didn't refresh it before it expired. If this is the case, and you're using the SDK, make sure you call getAccessToken() every time you need to use the access token. If you're not using the SDK, make sure you refresh the access token with the refresh endpoint.
    `,
    {
      expired_at_millis: expiredAt?.getTime() ?? null,
      project_id: projectId ?? null,
      user_id: userId ?? null,
      refresh_token_id: refreshTokenId ?? null
    }
  ], (json) => [
    json.expired_at_millis ? new Date(json.expired_at_millis) : void 0,
    json.project_id ?? void 0,
    json.user_id ?? void 0,
    json.refresh_token_id ?? void 0
  ]);
  var InvalidProjectForAccessToken = createKnownErrorConstructor(InvalidAccessToken, "INVALID_PROJECT_FOR_ACCESS_TOKEN", (expectedProjectId, actualProjectId) => [
    401,
    `Access token not valid for this project. Expected project ID ${JSON.stringify(expectedProjectId)}, but the token is for project ID ${JSON.stringify(actualProjectId)}.`,
    {
      expected_project_id: expectedProjectId,
      actual_project_id: actualProjectId
    }
  ], (json) => [json.expected_project_id, json.actual_project_id]);
  var RefreshTokenError = createKnownErrorConstructor(KnownError, "REFRESH_TOKEN_ERROR", "inherit", "inherit");
  var RefreshTokenNotFoundOrExpired = createKnownErrorConstructor(RefreshTokenError, "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED", () => [401, "Refresh token not found for this project, or the session has expired/been revoked."], () => []);
  var CannotDeleteCurrentSession = createKnownErrorConstructor(RefreshTokenError, "CANNOT_DELETE_CURRENT_SESSION", () => [400, "Cannot delete the current session."], () => []);
  var ProviderRejected = createKnownErrorConstructor(RefreshTokenError, "PROVIDER_REJECTED", () => [401, "The provider refused to refresh their token. This usually means that the provider used to authenticate the user no longer regards this session as valid, and the user must re-authenticate."], () => []);
  var UserWithEmailAlreadyExists = createKnownErrorConstructor(KnownError, "USER_EMAIL_ALREADY_EXISTS", (email, wouldWorkIfEmailWasVerified = false) => [
    409,
    `A user with email ${JSON.stringify(email)} already exists${wouldWorkIfEmailWasVerified ? " but the email is not verified. Please login to your existing account with the method you used to sign up, and then verify your email to sign in with this login method." : "."}`,
    {
      email,
      would_work_if_email_was_verified: wouldWorkIfEmailWasVerified
    }
  ], (json) => [json.email, json.would_work_if_email_was_verified ?? false]);
  var EmailNotVerified = createKnownErrorConstructor(KnownError, "EMAIL_NOT_VERIFIED", () => [400, "The email is not verified."], () => []);
  var CannotGetOwnUserWithoutUser = createKnownErrorConstructor(KnownError, "CANNOT_GET_OWN_USER_WITHOUT_USER", () => [400, "You have specified 'me' as a userId, but did not provide authentication for a user."], () => []);
  var UserIdDoesNotExist = createKnownErrorConstructor(KnownError, "USER_ID_DOES_NOT_EXIST", (userId) => [
    400,
    `The given user with the ID ${userId} does not exist.`,
    { user_id: userId }
  ], (json) => [json.user_id]);
  var UserNotFound = createKnownErrorConstructor(KnownError, "USER_NOT_FOUND", () => [404, "User not found."], () => []);
  var RestrictedUserNotAllowed = createKnownErrorConstructor(KnownError, "RESTRICTED_USER_NOT_ALLOWED", (restrictedReason) => [
    403,
    `The user in the access token is in restricted state. Reason: ${restrictedReason.type}. Please pass the X-Stack-Allow-Restricted-User header if this is intended.`,
    { restricted_reason: restrictedReason }
  ], (json) => [json.restricted_reason ?? { type: "anonymous" }]);
  var ProjectNotFound = createKnownErrorConstructor(KnownError, "PROJECT_NOT_FOUND", (projectId) => {
    if (typeof projectId !== "string") throw new StackAssertionError("projectId of KnownErrors.ProjectNotFound must be a string");
    return [
      404,
      `Project ${projectId} not found or is not accessible with the current user.`,
      { project_id: projectId }
    ];
  }, (json) => [json.project_id]);
  var CurrentProjectNotFound = createKnownErrorConstructor(KnownError, "CURRENT_PROJECT_NOT_FOUND", (projectId) => [
    400,
    `The current project with ID ${projectId} was not found. Please check the value of the x-stack-project-id header.`,
    { project_id: projectId }
  ], (json) => [json.project_id]);
  var BranchDoesNotExist = createKnownErrorConstructor(KnownError, "BRANCH_DOES_NOT_EXIST", (branchId) => [
    400,
    `The branch with ID ${branchId} does not exist.`,
    { branch_id: branchId }
  ], (json) => [json.branch_id]);
  var SignUpNotEnabled = createKnownErrorConstructor(KnownError, "SIGN_UP_NOT_ENABLED", () => [400, "Creation of new accounts is not enabled for this project. Please ask the project owner to enable it."], () => []);
  var SignUpRejected = createKnownErrorConstructor(KnownError, "SIGN_UP_REJECTED", (message) => [
    403,
    message ?? "Your sign up was rejected by an administrator's sign-up rule.",
    { message: message ?? "Your sign up was rejected by an administrator's sign-up rule." }
  ], (json) => [json.message]);
  var PasswordAuthenticationNotEnabled = createKnownErrorConstructor(KnownError, "PASSWORD_AUTHENTICATION_NOT_ENABLED", () => [400, "Password authentication is not enabled for this project."], () => []);
  var DataVaultStoreDoesNotExist = createKnownErrorConstructor(KnownError, "DATA_VAULT_STORE_DOES_NOT_EXIST", (storeId) => [
    400,
    `Data vault store with ID ${storeId} does not exist.`,
    { store_id: storeId }
  ], (json) => [json.store_id]);
  var DataVaultStoreHashedKeyDoesNotExist = createKnownErrorConstructor(KnownError, "DATA_VAULT_STORE_HASHED_KEY_DOES_NOT_EXIST", (storeId, hashedKey) => [
    400,
    `Data vault store with ID ${storeId} does not contain a key with hash ${hashedKey}.`,
    {
      store_id: storeId,
      hashed_key: hashedKey
    }
  ], (json) => [json.store_id, json.hashed_key]);
  var PasskeyAuthenticationNotEnabled = createKnownErrorConstructor(KnownError, "PASSKEY_AUTHENTICATION_NOT_ENABLED", () => [400, "Passkey authentication is not enabled for this project."], () => []);
  var AnonymousAccountsNotEnabled = createKnownErrorConstructor(KnownError, "ANONYMOUS_ACCOUNTS_NOT_ENABLED", () => [400, "Anonymous accounts are not enabled for this project."], () => []);
  var AnonymousAuthenticationNotAllowed = createKnownErrorConstructor(KnownError, "ANONYMOUS_AUTHENTICATION_NOT_ALLOWED", () => [401, "X-Stack-Access-Token is for an anonymous user, but anonymous users are not enabled. Set the X-Stack-Allow-Anonymous-User header of this request to 'true' to allow anonymous users."], () => []);
  var EmailPasswordMismatch = createKnownErrorConstructor(KnownError, "EMAIL_PASSWORD_MISMATCH", () => [400, "Wrong e-mail or password."], () => []);
  var RedirectUrlNotWhitelisted = createKnownErrorConstructor(KnownError, "REDIRECT_URL_NOT_WHITELISTED", () => [400, "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?"], () => []);
  var PasswordRequirementsNotMet = createKnownErrorConstructor(KnownError, "PASSWORD_REQUIREMENTS_NOT_MET", "inherit", "inherit");
  var PasswordTooShort = createKnownErrorConstructor(PasswordRequirementsNotMet, "PASSWORD_TOO_SHORT", (minLength) => [
    400,
    `Password too short. Minimum length is ${minLength}.`,
    { min_length: minLength }
  ], (json) => [json?.min_length ?? throwErr("min_length not found in PasswordTooShort details")]);
  var PasswordTooLong = createKnownErrorConstructor(PasswordRequirementsNotMet, "PASSWORD_TOO_LONG", (maxLength) => [
    400,
    `Password too long. Maximum length is ${maxLength}.`,
    { maxLength }
  ], (json) => [json?.maxLength ?? throwErr("maxLength not found in PasswordTooLong details")]);
  var UserDoesNotHavePassword = createKnownErrorConstructor(KnownError, "USER_DOES_NOT_HAVE_PASSWORD", () => [400, "This user does not have password authentication enabled."], () => []);
  var VerificationCodeError = createKnownErrorConstructor(KnownError, "VERIFICATION_ERROR", "inherit", "inherit");
  var VerificationCodeNotFound = createKnownErrorConstructor(VerificationCodeError, "VERIFICATION_CODE_NOT_FOUND", () => [404, "The verification code does not exist for this project."], () => []);
  var VerificationCodeExpired = createKnownErrorConstructor(VerificationCodeError, "VERIFICATION_CODE_EXPIRED", () => [400, "The verification code has expired."], () => []);
  var VerificationCodeAlreadyUsed = createKnownErrorConstructor(VerificationCodeError, "VERIFICATION_CODE_ALREADY_USED", () => [409, "The verification link has already been used."], () => []);
  var VerificationCodeMaxAttemptsReached = createKnownErrorConstructor(VerificationCodeError, "VERIFICATION_CODE_MAX_ATTEMPTS_REACHED", () => [400, "The verification code nonce has reached the maximum number of attempts. This code is not valid anymore."], () => []);
  var PasswordConfirmationMismatch = createKnownErrorConstructor(KnownError, "PASSWORD_CONFIRMATION_MISMATCH", () => [400, "Passwords do not match."], () => []);
  var EmailAlreadyVerified = createKnownErrorConstructor(KnownError, "EMAIL_ALREADY_VERIFIED", () => [409, "The e-mail is already verified."], () => []);
  var EmailNotAssociatedWithUser = createKnownErrorConstructor(KnownError, "EMAIL_NOT_ASSOCIATED_WITH_USER", () => [400, "The e-mail is not associated with a user that could log in with that e-mail."], () => []);
  var EmailIsNotPrimaryEmail = createKnownErrorConstructor(KnownError, "EMAIL_IS_NOT_PRIMARY_EMAIL", (email, primaryEmail) => [
    400,
    `The given e-mail (${email}) must equal the user's primary e-mail (${primaryEmail}).`,
    {
      email,
      primary_email: primaryEmail
    }
  ], (json) => [json.email, json.primary_email]);
  var PasskeyRegistrationFailed = createKnownErrorConstructor(KnownError, "PASSKEY_REGISTRATION_FAILED", (message) => [400, message], (json) => [json.message]);
  var PasskeyWebAuthnError = createKnownErrorConstructor(KnownError, "PASSKEY_WEBAUTHN_ERROR", (message, code) => [
    400,
    message,
    {
      message,
      code
    }
  ], (json) => [json.message, json.code]);
  var PasskeyAuthenticationFailed = createKnownErrorConstructor(KnownError, "PASSKEY_AUTHENTICATION_FAILED", (message) => [400, message], (json) => [json.message]);
  var PermissionNotFound = createKnownErrorConstructor(KnownError, "PERMISSION_NOT_FOUND", (permissionId) => [
    404,
    `Permission "${permissionId}" not found. Make sure you created it on the dashboard.`,
    { permission_id: permissionId }
  ], (json) => [json.permission_id]);
  var PermissionScopeMismatch = createKnownErrorConstructor(KnownError, "WRONG_PERMISSION_SCOPE", (permissionId, expectedScope, actualScope) => [
    404,
    `Permission ${JSON.stringify(permissionId)} not found. (It was found for a different scope ${JSON.stringify(actualScope)}, but scope ${JSON.stringify(expectedScope)} was expected.)`,
    {
      permission_id: permissionId,
      expected_scope: expectedScope,
      actual_scope: actualScope
    }
  ], (json) => [
    json.permission_id,
    json.expected_scope,
    json.actual_scope
  ]);
  var ContainedPermissionNotFound = createKnownErrorConstructor(KnownError, "CONTAINED_PERMISSION_NOT_FOUND", (permissionId) => [
    400,
    `Contained permission with ID "${permissionId}" not found. Make sure you created it on the dashboard.`,
    { permission_id: permissionId }
  ], (json) => [json.permission_id]);
  var TeamNotFound = createKnownErrorConstructor(KnownError, "TEAM_NOT_FOUND", (teamId) => [
    404,
    `Team ${teamId} not found.`,
    { team_id: teamId }
  ], (json) => [json.team_id]);
  createKnownErrorConstructor(KnownError, "TEAM_ALREADY_EXISTS", (teamId) => [
    409,
    `Team ${teamId} already exists.`,
    { team_id: teamId }
  ], (json) => [json.team_id]);
  var TeamMembershipNotFound = createKnownErrorConstructor(KnownError, "TEAM_MEMBERSHIP_NOT_FOUND", (teamId, userId) => [
    404,
    `User ${userId} is not found in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId
    }
  ], (json) => [json.team_id, json.user_id]);
  var TeamInvitationRestrictedUserNotAllowed = createKnownErrorConstructor(KnownError, "TEAM_INVITATION_RESTRICTED_USER_NOT_ALLOWED", (restrictedReason) => [
    403,
    `Restricted users cannot accept team invitations. Reason: ${restrictedReason.type}. Please complete the onboarding process before accepting team invitations.`,
    { restricted_reason: restrictedReason }
  ], (json) => [json.restricted_reason ?? { type: "anonymous" }]);
  var EmailTemplateAlreadyExists = createKnownErrorConstructor(KnownError, "EMAIL_TEMPLATE_ALREADY_EXISTS", () => [409, "Email template already exists."], () => []);
  var OAuthConnectionNotConnectedToUser = createKnownErrorConstructor(KnownError, "OAUTH_CONNECTION_NOT_CONNECTED_TO_USER", () => [400, "The OAuth connection is not connected to any user."], () => []);
  var OAuthConnectionAlreadyConnectedToAnotherUser = createKnownErrorConstructor(KnownError, "OAUTH_CONNECTION_ALREADY_CONNECTED_TO_ANOTHER_USER", () => [409, "The OAuth connection is already connected to another user."], () => []);
  var OAuthConnectionDoesNotHaveRequiredScope = createKnownErrorConstructor(KnownError, "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE", () => [400, "The OAuth connection does not have the required scope."], () => []);
  var OAuthAccessTokenNotAvailable = createKnownErrorConstructor(KnownError, "OAUTH_ACCESS_TOKEN_NOT_AVAILABLE", (provider, details) => [
    400,
    `Failed to retrieve an OAuth access token for the connected account (provider: ${provider}). ${details}`,
    {
      provider,
      details
    }
  ], (json) => [json.provider, json.details]);
  var OAuthExtraScopeNotAvailableWithSharedOAuthKeys = createKnownErrorConstructor(KnownError, "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS", () => [400, "Extra scopes are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use extra scopes."], () => []);
  var OAuthAccessTokenNotAvailableWithSharedOAuthKeys = createKnownErrorConstructor(KnownError, "OAUTH_ACCESS_TOKEN_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS", () => [400, "Access tokens are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use access tokens."], () => []);
  var InvalidOAuthClientIdOrSecret = createKnownErrorConstructor(KnownError, "INVALID_OAUTH_CLIENT_ID_OR_SECRET", (clientId) => [
    400,
    "The OAuth client ID or secret is invalid. The client ID must be equal to the project ID (potentially with a hash and a branch ID), and the client secret must be a publishable client key.",
    { client_id: clientId ?? null }
  ], (json) => [json.client_id ?? void 0]);
  var InvalidScope = createKnownErrorConstructor(KnownError, "INVALID_SCOPE", (scope) => [400, `The scope "${scope}" is not a valid OAuth scope for Stack.`], (json) => [json.scope]);
  var UserAlreadyConnectedToAnotherOAuthConnection = createKnownErrorConstructor(KnownError, "USER_ALREADY_CONNECTED_TO_ANOTHER_OAUTH_CONNECTION", () => [409, "The user is already connected to another OAuth account. Did you maybe selected the wrong account?"], () => []);
  var OuterOAuthTimeout = createKnownErrorConstructor(KnownError, "OUTER_OAUTH_TIMEOUT", () => [408, "The OAuth flow has timed out. Please sign in again."], () => []);
  var OAuthProviderNotFoundOrNotEnabled = createKnownErrorConstructor(KnownError, "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED", () => [400, "The OAuth provider is not found or not enabled."], () => []);
  var AppleBundleIdNotConfigured = createKnownErrorConstructor(KnownError, "APPLE_BUNDLE_ID_NOT_CONFIGURED", () => [400, "Apple Sign In is enabled, but no Bundle IDs are configured. Please add your app's Bundle ID in the Stack Auth dashboard under OAuth Providers > Apple > Apple Bundle IDs."], () => []);
  var OAuthProviderAccountIdAlreadyUsedForSignIn = createKnownErrorConstructor(KnownError, "OAUTH_PROVIDER_ACCOUNT_ID_ALREADY_USED_FOR_SIGN_IN", () => [400, `A provider with the same account ID is already used for signing in.`], () => []);
  var MultiFactorAuthenticationRequired = createKnownErrorConstructor(KnownError, "MULTI_FACTOR_AUTHENTICATION_REQUIRED", (attemptCode) => [
    400,
    `Multi-factor authentication is required for this user.`,
    { attempt_code: attemptCode }
  ], (json) => [json.attempt_code]);
  var InvalidTotpCode = createKnownErrorConstructor(KnownError, "INVALID_TOTP_CODE", () => [400, "The TOTP code is invalid. Please try again."], () => []);
  var UserAuthenticationRequired = createKnownErrorConstructor(KnownError, "USER_AUTHENTICATION_REQUIRED", () => [401, "User authentication required for this endpoint."], () => []);
  var TeamMembershipAlreadyExists = createKnownErrorConstructor(KnownError, "TEAM_MEMBERSHIP_ALREADY_EXISTS", () => [409, "Team membership already exists."], () => []);
  var ProjectPermissionRequired = createKnownErrorConstructor(KnownError, "PROJECT_PERMISSION_REQUIRED", (userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId}.`,
    {
      user_id: userId,
      permission_id: permissionId
    }
  ], (json) => [json.user_id, json.permission_id]);
  var TeamPermissionRequired = createKnownErrorConstructor(KnownError, "TEAM_PERMISSION_REQUIRED", (teamId, userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId} in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId,
      permission_id: permissionId
    }
  ], (json) => [
    json.team_id,
    json.user_id,
    json.permission_id
  ]);
  var TeamPermissionNotFound = createKnownErrorConstructor(KnownError, "TEAM_PERMISSION_NOT_FOUND", (teamId, userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId} in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId,
      permission_id: permissionId
    }
  ], (json) => [
    json.team_id,
    json.user_id,
    json.permission_id
  ]);
  var InvalidSharedOAuthProviderId = createKnownErrorConstructor(KnownError, "INVALID_SHARED_OAUTH_PROVIDER_ID", (providerId) => [
    400,
    `The shared OAuth provider with ID ${providerId} is not valid.`,
    { provider_id: providerId }
  ], (json) => [json.provider_id]);
  var InvalidStandardOAuthProviderId = createKnownErrorConstructor(KnownError, "INVALID_STANDARD_OAUTH_PROVIDER_ID", (providerId) => [
    400,
    `The standard OAuth provider with ID ${providerId} is not valid.`,
    { provider_id: providerId }
  ], (json) => [json.provider_id]);
  var InvalidAuthorizationCode = createKnownErrorConstructor(KnownError, "INVALID_AUTHORIZATION_CODE", () => [400, "The given authorization code is invalid."], () => []);
  var InvalidAppleCredentials = createKnownErrorConstructor(KnownError, "INVALID_APPLE_CREDENTIALS", () => [400, "The Apple Sign In credentials could not be verified. Please try signing in again."], () => []);
  var OAuthProviderAccessDenied = createKnownErrorConstructor(KnownError, "OAUTH_PROVIDER_ACCESS_DENIED", () => [400, "The OAuth provider denied access to the user."], () => []);
  var ContactChannelAlreadyUsedForAuthBySomeoneElse = createKnownErrorConstructor(KnownError, "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE", (type, contactChannelValue, wouldWorkIfEmailWasVerified = false) => [
    409,
    `This ${type} ${contactChannelValue ? `"(${contactChannelValue})"` : ""} is already used for authentication by another account${wouldWorkIfEmailWasVerified ? " but the email is not verified. Please login to your existing account with the method you used to sign up, and then verify your email to sign in with this login method." : "."}`,
    {
      type,
      contact_channel_value: contactChannelValue ?? null,
      would_work_if_email_was_verified: wouldWorkIfEmailWasVerified
    }
  ], (json) => [
    json.type,
    json.contact_channel_value,
    json.would_work_if_email_was_verified ?? false
  ]);
  var InvalidPollingCodeError = createKnownErrorConstructor(KnownError, "INVALID_POLLING_CODE", (details) => [
    400,
    "The polling code is invalid or does not exist.",
    details
  ], (json) => [json]);
  var CliAuthError = createKnownErrorConstructor(KnownError, "CLI_AUTH_ERROR", (message) => [400, message], (json) => [json.message]);
  var CliAuthExpiredError = createKnownErrorConstructor(KnownError, "CLI_AUTH_EXPIRED_ERROR", (message = "CLI authentication request expired. Please try again.") => [400, message], (json) => [json.message]);
  var CliAuthUsedError = createKnownErrorConstructor(KnownError, "CLI_AUTH_USED_ERROR", (message = "This authentication token has already been used.") => [400, message], (json) => [json.message]);
  var ApiKeyNotValid = createKnownErrorConstructor(KnownError, "API_KEY_NOT_VALID", "inherit", "inherit");
  var ApiKeyExpired = createKnownErrorConstructor(ApiKeyNotValid, "API_KEY_EXPIRED", () => [401, "API key has expired."], () => []);
  var ApiKeyRevoked = createKnownErrorConstructor(ApiKeyNotValid, "API_KEY_REVOKED", () => [401, "API key has been revoked."], () => []);
  var WrongApiKeyType = createKnownErrorConstructor(ApiKeyNotValid, "WRONG_API_KEY_TYPE", (expectedType, actualType) => [
    400,
    `This endpoint is for ${expectedType} API keys, but a ${actualType} API key was provided.`,
    {
      expected_type: expectedType,
      actual_type: actualType
    }
  ], (json) => [json.expected_type, json.actual_type]);
  var ApiKeyNotFound = createKnownErrorConstructor(ApiKeyNotValid, "API_KEY_NOT_FOUND", () => [404, "API key not found."], () => []);
  var PublicApiKeyCannotBeRevoked = createKnownErrorConstructor(ApiKeyNotValid, "PUBLIC_API_KEY_CANNOT_BE_REVOKED", () => [400, "Public API keys cannot be revoked by the secretscanner endpoint."], () => []);
  var PermissionIdAlreadyExists = createKnownErrorConstructor(KnownError, "PERMISSION_ID_ALREADY_EXISTS", (permissionId) => [
    400,
    `Permission with ID "${permissionId}" already exists. Choose a different ID.`,
    { permission_id: permissionId }
  ], (json) => [json.permission_id]);
  var EmailRenderingError = createKnownErrorConstructor(KnownError, "EMAIL_RENDERING_ERROR", (error) => [
    400,
    `Failed to render email with theme: ${error}`,
    { error }
  ], (json) => [json.error]);
  var RequiresCustomEmailServer = createKnownErrorConstructor(KnownError, "REQUIRES_CUSTOM_EMAIL_SERVER", () => [400, `This action requires a custom SMTP server. Please edit your email server configuration and try again.`], () => []);
  var EmailNotEditable = createKnownErrorConstructor(KnownError, "EMAIL_NOT_EDITABLE", (emailId, status) => [
    400,
    `Email with ID "${emailId}" cannot be edited because it is in status "${status}". Only emails in PAUSED, PREPARING, RENDERING, RENDER_ERROR, SCHEDULED, QUEUED, or SERVER_ERROR status can be edited.`,
    {
      email_id: emailId,
      status
    }
  ], (json) => [json.email_id, json.status]);
  var ItemNotFound = createKnownErrorConstructor(KnownError, "ITEM_NOT_FOUND", (itemId) => [
    404,
    `Item with ID "${itemId}" not found.`,
    { item_id: itemId }
  ], (json) => [json.item_id]);
  var ItemCustomerTypeDoesNotMatch = createKnownErrorConstructor(KnownError, "ITEM_CUSTOMER_TYPE_DOES_NOT_MATCH", (itemId, customerId, itemCustomerType, actualCustomerType) => [
    400,
    `The ${actualCustomerType} with ID ${JSON.stringify(customerId)} is not a valid customer for the item with ID ${JSON.stringify(itemId)}. ${itemCustomerType ? `The item is configured to only be available for ${itemCustomerType} customers, but the customer is a ${actualCustomerType}.` : `The item is missing a customer type field. Please make sure it is set up correctly in your project configuration.`}`,
    {
      item_id: itemId,
      customer_id: customerId,
      item_customer_type: itemCustomerType ?? null,
      actual_customer_type: actualCustomerType
    }
  ], (json) => [
    json.item_id,
    json.customer_id,
    json.item_customer_type ?? void 0,
    json.actual_customer_type
  ]);
  var CustomerDoesNotExist = createKnownErrorConstructor(KnownError, "CUSTOMER_DOES_NOT_EXIST", (customerId) => [
    400,
    `Customer with ID ${JSON.stringify(customerId)} does not exist.`,
    { customer_id: customerId }
  ], (json) => [json.customer_id]);
  var SubscriptionInvoiceNotFound = createKnownErrorConstructor(KnownError, "SUBSCRIPTION_INVOICE_NOT_FOUND", (subscriptionInvoiceId) => [
    404,
    `Subscription invoice with ID ${JSON.stringify(subscriptionInvoiceId)} does not exist.`,
    { subscription_invoice_id: subscriptionInvoiceId }
  ], (json) => [json.subscription_invoice_id]);
  var OneTimePurchaseNotFound = createKnownErrorConstructor(KnownError, "ONE_TIME_PURCHASE_NOT_FOUND", (purchaseId) => [
    404,
    `One-time purchase with ID ${JSON.stringify(purchaseId)} does not exist.`,
    { one_time_purchase_id: purchaseId }
  ], (json) => [json.one_time_purchase_id]);
  var SubscriptionAlreadyRefunded = createKnownErrorConstructor(KnownError, "SUBSCRIPTION_ALREADY_REFUNDED", (subscriptionId) => [
    400,
    `Subscription with ID ${JSON.stringify(subscriptionId)} was already refunded.`,
    { subscription_id: subscriptionId }
  ], (json) => [json.subscription_id]);
  var OneTimePurchaseAlreadyRefunded = createKnownErrorConstructor(KnownError, "ONE_TIME_PURCHASE_ALREADY_REFUNDED", (purchaseId) => [
    400,
    `One-time purchase with ID ${JSON.stringify(purchaseId)} was already refunded.`,
    { one_time_purchase_id: purchaseId }
  ], (json) => [json.one_time_purchase_id]);
  var TestModePurchaseNonRefundable = createKnownErrorConstructor(KnownError, "TEST_MODE_PURCHASE_NON_REFUNDABLE", () => [400, "Test mode purchases are not refundable."], () => []);
  var ProductDoesNotExist = createKnownErrorConstructor(KnownError, "PRODUCT_DOES_NOT_EXIST", (productId, context) => [
    400,
    `Product with ID ${JSON.stringify(productId)} ${context === "server_only" ? "is marked as server-only and cannot be accessed client side." : context === "item_exists" ? "does not exist, but an item with this ID exists." : "does not exist."}`,
    {
      product_id: productId,
      context
    }
  ], (json) => [json.product_id, json.context]);
  var ProductCustomerTypeDoesNotMatch = createKnownErrorConstructor(KnownError, "PRODUCT_CUSTOMER_TYPE_DOES_NOT_MATCH", (productId, customerId, productCustomerType, actualCustomerType) => [
    400,
    `The ${actualCustomerType} with ID ${JSON.stringify(customerId)} is not a valid customer for the inline product that has been passed in. ${productCustomerType ? `The product is configured to only be available for ${productCustomerType} customers, but the customer is a ${actualCustomerType}.` : `The product is missing a customer type field. Please make sure it is set up correctly in your project configuration.`}`,
    {
      product_id: productId ?? null,
      customer_id: customerId,
      product_customer_type: productCustomerType ?? null,
      actual_customer_type: actualCustomerType
    }
  ], (json) => [
    json.product_id ?? void 0,
    json.customer_id,
    json.product_customer_type ?? void 0,
    json.actual_customer_type
  ]);
  var ProductAlreadyGranted = createKnownErrorConstructor(KnownError, "PRODUCT_ALREADY_GRANTED", (productId, customerId) => [
    400,
    `Customer with ID ${JSON.stringify(customerId)} already owns product ${JSON.stringify(productId)}.`,
    {
      product_id: productId,
      customer_id: customerId
    }
  ], (json) => [json.product_id, json.customer_id]);
  var ItemQuantityInsufficientAmount = createKnownErrorConstructor(KnownError, "ITEM_QUANTITY_INSUFFICIENT_AMOUNT", (itemId, customerId, quantity) => [
    400,
    `The item with ID ${JSON.stringify(itemId)} has an insufficient quantity for the customer with ID ${JSON.stringify(customerId)}. An attempt was made to charge ${quantity} credits.`,
    {
      item_id: itemId,
      customer_id: customerId,
      quantity
    }
  ], (json) => [
    json.item_id,
    json.customer_id,
    json.quantity
  ]);
  var StripeAccountInfoNotFound = createKnownErrorConstructor(KnownError, "STRIPE_ACCOUNT_INFO_NOT_FOUND", () => [404, "Stripe account information not found. Please make sure the user has onboarded with Stripe."], () => []);
  var AnalyticsQueryTimeout = createKnownErrorConstructor(KnownError, "ANALYTICS_QUERY_TIMEOUT", (timeoutMs) => [
    400,
    `The query timed out. Please try again with a shorter query or increase the timeout. Timeout was ${timeoutMs}ms.`,
    { timeout_ms: timeoutMs }
  ], (json) => [json.timeout_ms]);
  var AnalyticsQueryError = createKnownErrorConstructor(KnownError, "ANALYTICS_QUERY_ERROR", (error) => [
    400,
    `${error}`,
    { error }
  ], (json) => [json.error]);
  var AnalyticsNotEnabled = createKnownErrorConstructor(KnownError, "ANALYTICS_NOT_ENABLED", () => [400, "Analytics is not enabled for this project."], () => []);
  var DefaultPaymentMethodRequired = createKnownErrorConstructor(KnownError, "DEFAULT_PAYMENT_METHOD_REQUIRED", (customerType, customerId) => [
    400,
    "No default payment method is set for this customer.",
    {
      customer_type: customerType,
      customer_id: customerId
    }
  ], (json) => [json.customer_type, json.customer_id]);
  var NewPurchasesBlocked = createKnownErrorConstructor(KnownError, "NEW_PURCHASES_BLOCKED", () => [403, "New purchases are currently blocked for this project. Please contact support for more information."], () => []);
  var KnownErrors = {
    CannotDeleteCurrentSession,
    UnsupportedError,
    BodyParsingError,
    SchemaError,
    AllOverloadsFailed,
    ProjectAuthenticationError,
    PermissionIdAlreadyExists,
    CliAuthError,
    CliAuthExpiredError,
    CliAuthUsedError,
    InvalidProjectAuthentication,
    ProjectKeyWithoutAccessType,
    InvalidAccessType,
    AccessTypeWithoutProjectId,
    AccessTypeRequired,
    CannotGetOwnUserWithoutUser,
    InsufficientAccessType,
    InvalidPublishableClientKey,
    InvalidSecretServerKey,
    InvalidSuperSecretAdminKey,
    InvalidAdminAccessToken,
    UnparsableAdminAccessToken,
    AdminAccessTokenExpired,
    InvalidProjectForAdminAccessToken,
    AdminAccessTokenIsNotAdmin,
    ProjectAuthenticationRequired,
    ClientAuthenticationRequired,
    PublishableClientKeyRequiredForProject,
    ServerAuthenticationRequired,
    ClientOrServerAuthenticationRequired,
    ClientOrAdminAuthenticationRequired,
    ClientOrServerOrAdminAuthenticationRequired,
    AdminAuthenticationRequired,
    ExpectedInternalProject,
    SessionAuthenticationError,
    InvalidSessionAuthentication,
    InvalidAccessToken,
    UnparsableAccessToken,
    AccessTokenExpired,
    InvalidProjectForAccessToken,
    RefreshTokenError,
    ProviderRejected,
    RefreshTokenNotFoundOrExpired,
    UserWithEmailAlreadyExists,
    EmailNotVerified,
    UserIdDoesNotExist,
    UserNotFound,
    RestrictedUserNotAllowed,
    ApiKeyNotFound,
    PublicApiKeyCannotBeRevoked,
    ProjectNotFound,
    CurrentProjectNotFound,
    BranchDoesNotExist,
    SignUpNotEnabled,
    SignUpRejected,
    PasswordAuthenticationNotEnabled,
    PasskeyAuthenticationNotEnabled,
    AnonymousAccountsNotEnabled,
    AnonymousAuthenticationNotAllowed,
    EmailPasswordMismatch,
    RedirectUrlNotWhitelisted,
    PasswordRequirementsNotMet,
    PasswordTooShort,
    PasswordTooLong,
    UserDoesNotHavePassword,
    VerificationCodeError,
    VerificationCodeNotFound,
    VerificationCodeExpired,
    VerificationCodeAlreadyUsed,
    VerificationCodeMaxAttemptsReached,
    PasswordConfirmationMismatch,
    EmailAlreadyVerified,
    EmailNotAssociatedWithUser,
    EmailIsNotPrimaryEmail,
    PasskeyRegistrationFailed,
    PasskeyWebAuthnError,
    PasskeyAuthenticationFailed,
    PermissionNotFound,
    PermissionScopeMismatch,
    ContainedPermissionNotFound,
    TeamNotFound,
    TeamMembershipNotFound,
    TeamInvitationRestrictedUserNotAllowed,
    EmailTemplateAlreadyExists,
    OAuthConnectionNotConnectedToUser,
    OAuthConnectionAlreadyConnectedToAnotherUser,
    OAuthConnectionDoesNotHaveRequiredScope,
    OAuthAccessTokenNotAvailable,
    OAuthExtraScopeNotAvailableWithSharedOAuthKeys,
    OAuthAccessTokenNotAvailableWithSharedOAuthKeys,
    InvalidOAuthClientIdOrSecret,
    InvalidScope,
    UserAlreadyConnectedToAnotherOAuthConnection,
    OuterOAuthTimeout,
    OAuthProviderNotFoundOrNotEnabled,
    AppleBundleIdNotConfigured,
    OAuthProviderAccountIdAlreadyUsedForSignIn,
    MultiFactorAuthenticationRequired,
    InvalidTotpCode,
    UserAuthenticationRequired,
    TeamMembershipAlreadyExists,
    ProjectPermissionRequired,
    TeamPermissionRequired,
    InvalidSharedOAuthProviderId,
    InvalidStandardOAuthProviderId,
    InvalidAuthorizationCode,
    InvalidAppleCredentials,
    TeamPermissionNotFound,
    OAuthProviderAccessDenied,
    ContactChannelAlreadyUsedForAuthBySomeoneElse,
    InvalidPollingCodeError,
    ApiKeyNotValid,
    ApiKeyExpired,
    ApiKeyRevoked,
    WrongApiKeyType,
    EmailRenderingError,
    RequiresCustomEmailServer,
    EmailNotEditable,
    ItemNotFound,
    ItemCustomerTypeDoesNotMatch,
    CustomerDoesNotExist,
    ProductDoesNotExist,
    ProductCustomerTypeDoesNotMatch,
    ProductAlreadyGranted,
    SubscriptionInvoiceNotFound,
    OneTimePurchaseNotFound,
    SubscriptionAlreadyRefunded,
    OneTimePurchaseAlreadyRefunded,
    TestModePurchaseNonRefundable,
    ItemQuantityInsufficientAmount,
    StripeAccountInfoNotFound,
    DefaultPaymentMethodRequired,
    NewPurchasesBlocked,
    DataVaultStoreDoesNotExist,
    DataVaultStoreHashedKeyDoesNotExist,
    AnalyticsQueryTimeout,
    AnalyticsQueryError,
    AnalyticsNotEnabled
  };
  var knownErrorCodes = /* @__PURE__ */ new Set();
  for (const [_, KnownError2] of Object.entries(KnownErrors)) {
    if (knownErrorCodes.has(KnownError2.errorCode)) throw new Error(`Duplicate known error code: ${KnownError2.errorCode}`);
    knownErrorCodes.add(KnownError2.errorCode);
  }

  // ../stack-shared/dist/esm/utils/bytes.js
  function decodeBase64(input) {
    return new Uint8Array(atob(input).split("").map((char) => char.charCodeAt(0)));
  }
  function isBase64(input) {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input);
  }

  // ../stack-shared/dist/esm/utils/crypto.js
  function generateRandomValues(array2) {
    if (!globalVar.crypto) throw new StackAssertionError("Crypto API is not available in this environment. Are you using an old browser?");
    if (!globalVar.crypto.getRandomValues) throw new StackAssertionError("crypto.getRandomValues is not available in this environment. Are you using an old browser?");
    return globalVar.crypto.getRandomValues(array2);
  }

  // ../stack-shared/dist/esm/utils/urls.js
  function createUrlIfValid(...args) {
    try {
      return new URL(...args);
    } catch (e15) {
      return null;
    }
  }
  function isValidUrl(url) {
    return !!createUrlIfValid(url);
  }
  function isValidHostname(hostname) {
    if (!hostname || hostname.startsWith(".") || hostname.endsWith(".") || hostname.includes("..")) return false;
    const url = createUrlIfValid(`https://${hostname}`);
    if (!url) return false;
    return url.hostname === hostname;
  }
  function isValidHostnameWithWildcards(hostname) {
    if (!hostname) return false;
    if (!hostname.includes("*")) return isValidHostname(hostname);
    if (hostname.startsWith(".") || hostname.endsWith(".")) return false;
    if (hostname.includes("..")) return false;
    const testHostname = hostname.replace(/\*+/g, "wildcard");
    if (!/^[a-zA-Z0-9.-]+$/.test(testHostname)) return false;
    const segments = hostname.split(/\*+/);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment === "") continue;
      if (i === 0 && segment.startsWith(".")) return false;
      if (i === segments.length - 1 && segment.endsWith(".")) return false;
      if (segment.includes("..")) return false;
    }
    return true;
  }

  // ../../node_modules/.pnpm/yup@1.7.1/node_modules/yup/index.esm.js
  var import_property_expr = __toESM(require_property_expr());
  var import_tiny_case = __toESM(require_tiny_case());
  var import_toposort = __toESM(require_toposort());
  var toString = Object.prototype.toString;
  var errorToString = Error.prototype.toString;
  var regExpToString = RegExp.prototype.toString;
  var symbolToString = typeof Symbol !== "undefined" ? Symbol.prototype.toString : () => "";
  var SYMBOL_REGEXP = /^Symbol\((.*)\)(.*)$/;
  function printNumber(val) {
    if (val != +val) return "NaN";
    const isNegativeZero = val === 0 && 1 / val < 0;
    return isNegativeZero ? "-0" : "" + val;
  }
  function printSimpleValue(val, quoteStrings = false) {
    if (val == null || val === true || val === false) return "" + val;
    const typeOf = typeof val;
    if (typeOf === "number") return printNumber(val);
    if (typeOf === "string") return quoteStrings ? `"${val}"` : val;
    if (typeOf === "function") return "[Function " + (val.name || "anonymous") + "]";
    if (typeOf === "symbol") return symbolToString.call(val).replace(SYMBOL_REGEXP, "Symbol($1)");
    const tag = toString.call(val).slice(8, -1);
    if (tag === "Date") return isNaN(val.getTime()) ? "" + val : val.toISOString(val);
    if (tag === "Error" || val instanceof Error) return "[" + errorToString.call(val) + "]";
    if (tag === "RegExp") return regExpToString.call(val);
    return null;
  }
  function printValue(value, quoteStrings) {
    let result = printSimpleValue(value, quoteStrings);
    if (result !== null) return result;
    return JSON.stringify(value, function(key, value2) {
      let result2 = printSimpleValue(this[key], quoteStrings);
      if (result2 !== null) return result2;
      return value2;
    }, 2);
  }
  function toArray(value) {
    return value == null ? [] : [].concat(value);
  }
  var _Symbol$toStringTag;
  var _Symbol$hasInstance;
  var _Symbol$toStringTag2;
  var strReg = /\$\{\s*(\w+)\s*\}/g;
  _Symbol$toStringTag = Symbol.toStringTag;
  var ValidationErrorNoStack = class {
    constructor(errorOrErrors, value, field, type) {
      this.name = void 0;
      this.message = void 0;
      this.value = void 0;
      this.path = void 0;
      this.type = void 0;
      this.params = void 0;
      this.errors = void 0;
      this.inner = void 0;
      this[_Symbol$toStringTag] = "Error";
      this.name = "ValidationError";
      this.value = value;
      this.path = field;
      this.type = type;
      this.errors = [];
      this.inner = [];
      toArray(errorOrErrors).forEach((err) => {
        if (ValidationError.isError(err)) {
          this.errors.push(...err.errors);
          const innerErrors = err.inner.length ? err.inner : [err];
          this.inner.push(...innerErrors);
        } else {
          this.errors.push(err);
        }
      });
      this.message = this.errors.length > 1 ? `${this.errors.length} errors occurred` : this.errors[0];
    }
  };
  _Symbol$hasInstance = Symbol.hasInstance;
  _Symbol$toStringTag2 = Symbol.toStringTag;
  var ValidationError = class _ValidationError extends Error {
    static formatError(message, params) {
      const path = params.label || params.path || "this";
      params = Object.assign({}, params, {
        path,
        originalPath: params.path
      });
      if (typeof message === "string") return message.replace(strReg, (_, key) => printValue(params[key]));
      if (typeof message === "function") return message(params);
      return message;
    }
    static isError(err) {
      return err && err.name === "ValidationError";
    }
    constructor(errorOrErrors, value, field, type, disableStack) {
      const errorNoStack = new ValidationErrorNoStack(errorOrErrors, value, field, type);
      if (disableStack) {
        return errorNoStack;
      }
      super();
      this.value = void 0;
      this.path = void 0;
      this.type = void 0;
      this.params = void 0;
      this.errors = [];
      this.inner = [];
      this[_Symbol$toStringTag2] = "Error";
      this.name = errorNoStack.name;
      this.message = errorNoStack.message;
      this.type = errorNoStack.type;
      this.value = errorNoStack.value;
      this.path = errorNoStack.path;
      this.errors = errorNoStack.errors;
      this.inner = errorNoStack.inner;
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, _ValidationError);
      }
    }
    static [_Symbol$hasInstance](inst) {
      return ValidationErrorNoStack[Symbol.hasInstance](inst) || super[Symbol.hasInstance](inst);
    }
  };
  var mixed = {
    default: "${path} is invalid",
    required: "${path} is a required field",
    defined: "${path} must be defined",
    notNull: "${path} cannot be null",
    oneOf: "${path} must be one of the following values: ${values}",
    notOneOf: "${path} must not be one of the following values: ${values}",
    notType: ({
      path,
      type,
      value,
      originalValue
    }) => {
      const castMsg = originalValue != null && originalValue !== value ? ` (cast from the value \`${printValue(originalValue, true)}\`).` : ".";
      return type !== "mixed" ? `${path} must be a \`${type}\` type, but the final value was: \`${printValue(value, true)}\`` + castMsg : `${path} must match the configured type. The validated value was: \`${printValue(value, true)}\`` + castMsg;
    }
  };
  var string = {
    length: "${path} must be exactly ${length} characters",
    min: "${path} must be at least ${min} characters",
    max: "${path} must be at most ${max} characters",
    matches: '${path} must match the following: "${regex}"',
    email: "${path} must be a valid email",
    url: "${path} must be a valid URL",
    uuid: "${path} must be a valid UUID",
    datetime: "${path} must be a valid ISO date-time",
    datetime_precision: "${path} must be a valid ISO date-time with a sub-second precision of exactly ${precision} digits",
    datetime_offset: '${path} must be a valid ISO date-time with UTC "Z" timezone',
    trim: "${path} must be a trimmed string",
    lowercase: "${path} must be a lowercase string",
    uppercase: "${path} must be a upper case string"
  };
  var number = {
    min: "${path} must be greater than or equal to ${min}",
    max: "${path} must be less than or equal to ${max}",
    lessThan: "${path} must be less than ${less}",
    moreThan: "${path} must be greater than ${more}",
    positive: "${path} must be a positive number",
    negative: "${path} must be a negative number",
    integer: "${path} must be an integer"
  };
  var date = {
    min: "${path} field must be later than ${min}",
    max: "${path} field must be at earlier than ${max}"
  };
  var boolean = {
    isValue: "${path} field must be ${value}"
  };
  var object = {
    noUnknown: "${path} field has unspecified keys: ${unknown}",
    exact: "${path} object contains unknown properties: ${properties}"
  };
  var array = {
    min: "${path} field must have at least ${min} items",
    max: "${path} field must have less than or equal to ${max} items",
    length: "${path} must have ${length} items"
  };
  var tuple = {
    notType: (params) => {
      const {
        path,
        value,
        spec
      } = params;
      const typeLen = spec.types.length;
      if (Array.isArray(value)) {
        if (value.length < typeLen) return `${path} tuple value has too few items, expected a length of ${typeLen} but got ${value.length} for value: \`${printValue(value, true)}\``;
        if (value.length > typeLen) return `${path} tuple value has too many items, expected a length of ${typeLen} but got ${value.length} for value: \`${printValue(value, true)}\``;
      }
      return ValidationError.formatError(mixed.notType, params);
    }
  };
  var locale = Object.assign(/* @__PURE__ */ Object.create(null), {
    mixed,
    string,
    number,
    date,
    object,
    array,
    boolean,
    tuple
  });
  var isSchema = (obj) => obj && obj.__isYupSchema__;
  var Condition = class _Condition {
    static fromOptions(refs, config) {
      if (!config.then && !config.otherwise) throw new TypeError("either `then:` or `otherwise:` is required for `when()` conditions");
      let {
        is,
        then,
        otherwise
      } = config;
      let check = typeof is === "function" ? is : (...values) => values.every((value) => value === is);
      return new _Condition(refs, (values, schema) => {
        var _branch;
        let branch = check(...values) ? then : otherwise;
        return (_branch = branch == null ? void 0 : branch(schema)) != null ? _branch : schema;
      });
    }
    constructor(refs, builder) {
      this.fn = void 0;
      this.refs = refs;
      this.refs = refs;
      this.fn = builder;
    }
    resolve(base, options) {
      let values = this.refs.map((ref) => (
        // TODO: ? operator here?
        ref.getValue(options == null ? void 0 : options.value, options == null ? void 0 : options.parent, options == null ? void 0 : options.context)
      ));
      let schema = this.fn(values, base, options);
      if (schema === void 0 || // @ts-ignore this can be base
      schema === base) {
        return base;
      }
      if (!isSchema(schema)) throw new TypeError("conditions must return a schema object");
      return schema.resolve(options);
    }
  };
  var prefixes = {
    context: "$",
    value: "."
  };
  var Reference = class {
    constructor(key, options = {}) {
      this.key = void 0;
      this.isContext = void 0;
      this.isValue = void 0;
      this.isSibling = void 0;
      this.path = void 0;
      this.getter = void 0;
      this.map = void 0;
      if (typeof key !== "string") throw new TypeError("ref must be a string, got: " + key);
      this.key = key.trim();
      if (key === "") throw new TypeError("ref must be a non-empty string");
      this.isContext = this.key[0] === prefixes.context;
      this.isValue = this.key[0] === prefixes.value;
      this.isSibling = !this.isContext && !this.isValue;
      let prefix = this.isContext ? prefixes.context : this.isValue ? prefixes.value : "";
      this.path = this.key.slice(prefix.length);
      this.getter = this.path && (0, import_property_expr.getter)(this.path, true);
      this.map = options.map;
    }
    getValue(value, parent, context) {
      let result = this.isContext ? context : this.isValue ? value : parent;
      if (this.getter) result = this.getter(result || {});
      if (this.map) result = this.map(result);
      return result;
    }
    /**
     *
     * @param {*} value
     * @param {Object} options
     * @param {Object=} options.context
     * @param {Object=} options.parent
     */
    cast(value, options) {
      return this.getValue(value, options == null ? void 0 : options.parent, options == null ? void 0 : options.context);
    }
    resolve() {
      return this;
    }
    describe() {
      return {
        type: "ref",
        key: this.key
      };
    }
    toString() {
      return `Ref(${this.key})`;
    }
    static isRef(value) {
      return value && value.__isYupRef;
    }
  };
  Reference.prototype.__isYupRef = true;
  var isAbsent = (value) => value == null;
  function createValidation(config) {
    function validate({
      value,
      path = "",
      options,
      originalValue,
      schema
    }, panic, next) {
      const {
        name,
        test,
        params,
        message,
        skipAbsent
      } = config;
      let {
        parent,
        context,
        abortEarly = schema.spec.abortEarly,
        disableStackTrace = schema.spec.disableStackTrace
      } = options;
      const resolveOptions = {
        value,
        parent,
        context
      };
      function createError(overrides = {}) {
        const nextParams = resolveParams(Object.assign({
          value,
          originalValue,
          label: schema.spec.label,
          path: overrides.path || path,
          spec: schema.spec,
          disableStackTrace: overrides.disableStackTrace || disableStackTrace
        }, params, overrides.params), resolveOptions);
        const error = new ValidationError(ValidationError.formatError(overrides.message || message, nextParams), value, nextParams.path, overrides.type || name, nextParams.disableStackTrace);
        error.params = nextParams;
        return error;
      }
      const invalid = abortEarly ? panic : next;
      let ctx = {
        path,
        parent,
        type: name,
        from: options.from,
        createError,
        resolve(item) {
          return resolveMaybeRef(item, resolveOptions);
        },
        options,
        originalValue,
        schema
      };
      const handleResult = (validOrError) => {
        if (ValidationError.isError(validOrError)) invalid(validOrError);
        else if (!validOrError) invalid(createError());
        else next(null);
      };
      const handleError = (err) => {
        if (ValidationError.isError(err)) invalid(err);
        else panic(err);
      };
      const shouldSkip = skipAbsent && isAbsent(value);
      if (shouldSkip) {
        return handleResult(true);
      }
      let result;
      try {
        var _result;
        result = test.call(ctx, value, ctx);
        if (typeof ((_result = result) == null ? void 0 : _result.then) === "function") {
          if (options.sync) {
            throw new Error(`Validation test of type: "${ctx.type}" returned a Promise during a synchronous validate. This test will finish after the validate call has returned`);
          }
          return Promise.resolve(result).then(handleResult, handleError);
        }
      } catch (err) {
        handleError(err);
        return;
      }
      handleResult(result);
    }
    validate.OPTIONS = config;
    return validate;
  }
  function resolveParams(params, options) {
    if (!params) return params;
    for (const key of Object.keys(params)) {
      params[key] = resolveMaybeRef(params[key], options);
    }
    return params;
  }
  function resolveMaybeRef(item, options) {
    return Reference.isRef(item) ? item.getValue(options.value, options.parent, options.context) : item;
  }
  function getIn(schema, path, value, context = value) {
    let parent, lastPart, lastPartDebug;
    if (!path) return {
      parent,
      parentPath: path,
      schema
    };
    (0, import_property_expr.forEach)(path, (_part, isBracket, isArray) => {
      let part = isBracket ? _part.slice(1, _part.length - 1) : _part;
      schema = schema.resolve({
        context,
        parent,
        value
      });
      let isTuple = schema.type === "tuple";
      let idx = isArray ? parseInt(part, 10) : 0;
      if (schema.innerType || isTuple) {
        if (isTuple && !isArray) throw new Error(`Yup.reach cannot implicitly index into a tuple type. the path part "${lastPartDebug}" must contain an index to the tuple element, e.g. "${lastPartDebug}[0]"`);
        if (value && idx >= value.length) {
          throw new Error(`Yup.reach cannot resolve an array item at index: ${_part}, in the path: ${path}. because there is no value at that index. `);
        }
        parent = value;
        value = value && value[idx];
        schema = isTuple ? schema.spec.types[idx] : schema.innerType;
      }
      if (!isArray) {
        if (!schema.fields || !schema.fields[part]) throw new Error(`The schema does not contain the path: ${path}. (failed at: ${lastPartDebug} which is a type: "${schema.type}")`);
        parent = value;
        value = value && value[part];
        schema = schema.fields[part];
      }
      lastPart = part;
      lastPartDebug = isBracket ? "[" + _part + "]" : "." + _part;
    });
    return {
      schema,
      parent,
      parentPath: lastPart
    };
  }
  function reach(obj, path, value, context) {
    return getIn(obj, path, value, context).schema;
  }
  var ReferenceSet = class _ReferenceSet extends Set {
    describe() {
      const description = [];
      for (const item of this.values()) {
        description.push(Reference.isRef(item) ? item.describe() : item);
      }
      return description;
    }
    resolveAll(resolve) {
      let result = [];
      for (const item of this.values()) {
        result.push(resolve(item));
      }
      return result;
    }
    clone() {
      return new _ReferenceSet(this.values());
    }
    merge(newItems, removeItems) {
      const next = this.clone();
      newItems.forEach((value) => next.add(value));
      removeItems.forEach((value) => next.delete(value));
      return next;
    }
  };
  function clone(src, seen = /* @__PURE__ */ new Map()) {
    if (isSchema(src) || !src || typeof src !== "object") return src;
    if (seen.has(src)) return seen.get(src);
    let copy;
    if (src instanceof Date) {
      copy = new Date(src.getTime());
      seen.set(src, copy);
    } else if (src instanceof RegExp) {
      copy = new RegExp(src);
      seen.set(src, copy);
    } else if (Array.isArray(src)) {
      copy = new Array(src.length);
      seen.set(src, copy);
      for (let i = 0; i < src.length; i++) copy[i] = clone(src[i], seen);
    } else if (src instanceof Map) {
      copy = /* @__PURE__ */ new Map();
      seen.set(src, copy);
      for (const [k, v] of src.entries()) copy.set(k, clone(v, seen));
    } else if (src instanceof Set) {
      copy = /* @__PURE__ */ new Set();
      seen.set(src, copy);
      for (const v of src) copy.add(clone(v, seen));
    } else if (src instanceof Object) {
      copy = {};
      seen.set(src, copy);
      for (const [k, v] of Object.entries(src)) copy[k] = clone(v, seen);
    } else {
      throw Error(`Unable to clone ${src}`);
    }
    return copy;
  }
  function createStandardPath(path) {
    if (!(path != null && path.length)) {
      return void 0;
    }
    const segments = [];
    let currentSegment = "";
    let inBrackets = false;
    let inQuotes = false;
    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      if (char === "[" && !inQuotes) {
        if (currentSegment) {
          segments.push(...currentSegment.split(".").filter(Boolean));
          currentSegment = "";
        }
        inBrackets = true;
        continue;
      }
      if (char === "]" && !inQuotes) {
        if (currentSegment) {
          if (/^\d+$/.test(currentSegment)) {
            segments.push(currentSegment);
          } else {
            segments.push(currentSegment.replace(/^"|"$/g, ""));
          }
          currentSegment = "";
        }
        inBrackets = false;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === "." && !inBrackets && !inQuotes) {
        if (currentSegment) {
          segments.push(currentSegment);
          currentSegment = "";
        }
        continue;
      }
      currentSegment += char;
    }
    if (currentSegment) {
      segments.push(...currentSegment.split(".").filter(Boolean));
    }
    return segments;
  }
  function createStandardIssues(error, parentPath) {
    const path = parentPath ? `${parentPath}.${error.path}` : error.path;
    return error.errors.map((err) => ({
      message: err,
      path: createStandardPath(path)
    }));
  }
  function issuesFromValidationError(error, parentPath) {
    var _error$inner;
    if (!((_error$inner = error.inner) != null && _error$inner.length) && error.errors.length) {
      return createStandardIssues(error, parentPath);
    }
    const path = parentPath ? `${parentPath}.${error.path}` : error.path;
    return error.inner.flatMap((err) => issuesFromValidationError(err, path));
  }
  var Schema = class {
    constructor(options) {
      this.type = void 0;
      this.deps = [];
      this.tests = void 0;
      this.transforms = void 0;
      this.conditions = [];
      this._mutate = void 0;
      this.internalTests = {};
      this._whitelist = new ReferenceSet();
      this._blacklist = new ReferenceSet();
      this.exclusiveTests = /* @__PURE__ */ Object.create(null);
      this._typeCheck = void 0;
      this.spec = void 0;
      this.tests = [];
      this.transforms = [];
      this.withMutation(() => {
        this.typeError(mixed.notType);
      });
      this.type = options.type;
      this._typeCheck = options.check;
      this.spec = Object.assign({
        strip: false,
        strict: false,
        abortEarly: true,
        recursive: true,
        disableStackTrace: false,
        nullable: false,
        optional: true,
        coerce: true
      }, options == null ? void 0 : options.spec);
      this.withMutation((s4) => {
        s4.nonNullable();
      });
    }
    // TODO: remove
    get _type() {
      return this.type;
    }
    clone(spec) {
      if (this._mutate) {
        if (spec) Object.assign(this.spec, spec);
        return this;
      }
      const next = Object.create(Object.getPrototypeOf(this));
      next.type = this.type;
      next._typeCheck = this._typeCheck;
      next._whitelist = this._whitelist.clone();
      next._blacklist = this._blacklist.clone();
      next.internalTests = Object.assign({}, this.internalTests);
      next.exclusiveTests = Object.assign({}, this.exclusiveTests);
      next.deps = [...this.deps];
      next.conditions = [...this.conditions];
      next.tests = [...this.tests];
      next.transforms = [...this.transforms];
      next.spec = clone(Object.assign({}, this.spec, spec));
      return next;
    }
    label(label) {
      let next = this.clone();
      next.spec.label = label;
      return next;
    }
    meta(...args) {
      if (args.length === 0) return this.spec.meta;
      let next = this.clone();
      next.spec.meta = Object.assign(next.spec.meta || {}, args[0]);
      return next;
    }
    withMutation(fn) {
      let before = this._mutate;
      this._mutate = true;
      let result = fn(this);
      this._mutate = before;
      return result;
    }
    concat(schema) {
      if (!schema || schema === this) return this;
      if (schema.type !== this.type && this.type !== "mixed") throw new TypeError(`You cannot \`concat()\` schema's of different types: ${this.type} and ${schema.type}`);
      let base = this;
      let combined = schema.clone();
      const mergedSpec = Object.assign({}, base.spec, combined.spec);
      combined.spec = mergedSpec;
      combined.internalTests = Object.assign({}, base.internalTests, combined.internalTests);
      combined._whitelist = base._whitelist.merge(schema._whitelist, schema._blacklist);
      combined._blacklist = base._blacklist.merge(schema._blacklist, schema._whitelist);
      combined.tests = base.tests;
      combined.exclusiveTests = base.exclusiveTests;
      combined.withMutation((next) => {
        schema.tests.forEach((fn) => {
          next.test(fn.OPTIONS);
        });
      });
      combined.transforms = [...base.transforms, ...combined.transforms];
      return combined;
    }
    isType(v) {
      if (v == null) {
        if (this.spec.nullable && v === null) return true;
        if (this.spec.optional && v === void 0) return true;
        return false;
      }
      return this._typeCheck(v);
    }
    resolve(options) {
      let schema = this;
      if (schema.conditions.length) {
        let conditions = schema.conditions;
        schema = schema.clone();
        schema.conditions = [];
        schema = conditions.reduce((prevSchema, condition) => condition.resolve(prevSchema, options), schema);
        schema = schema.resolve(options);
      }
      return schema;
    }
    resolveOptions(options) {
      var _options$strict, _options$abortEarly, _options$recursive, _options$disableStack;
      return Object.assign({}, options, {
        from: options.from || [],
        strict: (_options$strict = options.strict) != null ? _options$strict : this.spec.strict,
        abortEarly: (_options$abortEarly = options.abortEarly) != null ? _options$abortEarly : this.spec.abortEarly,
        recursive: (_options$recursive = options.recursive) != null ? _options$recursive : this.spec.recursive,
        disableStackTrace: (_options$disableStack = options.disableStackTrace) != null ? _options$disableStack : this.spec.disableStackTrace
      });
    }
    /**
     * Run the configured transform pipeline over an input value.
     */
    cast(value, options = {}) {
      let resolvedSchema = this.resolve(Object.assign({}, options, {
        value
        // parent: options.parent,
        // context: options.context,
      }));
      let allowOptionality = options.assert === "ignore-optionality";
      let result = resolvedSchema._cast(value, options);
      if (options.assert !== false && !resolvedSchema.isType(result)) {
        if (allowOptionality && isAbsent(result)) {
          return result;
        }
        let formattedValue = printValue(value);
        let formattedResult = printValue(result);
        throw new TypeError(`The value of ${options.path || "field"} could not be cast to a value that satisfies the schema type: "${resolvedSchema.type}". 

attempted value: ${formattedValue} 
` + (formattedResult !== formattedValue ? `result of cast: ${formattedResult}` : ""));
      }
      return result;
    }
    _cast(rawValue, options) {
      let value = rawValue === void 0 ? rawValue : this.transforms.reduce((prevValue, fn) => fn.call(this, prevValue, rawValue, this, options), rawValue);
      if (value === void 0) {
        value = this.getDefault(options);
      }
      return value;
    }
    _validate(_value, options = {}, panic, next) {
      let {
        path,
        originalValue = _value,
        strict = this.spec.strict
      } = options;
      let value = _value;
      if (!strict) {
        value = this._cast(value, Object.assign({
          assert: false
        }, options));
      }
      let initialTests = [];
      for (let test of Object.values(this.internalTests)) {
        if (test) initialTests.push(test);
      }
      this.runTests({
        path,
        value,
        originalValue,
        options,
        tests: initialTests
      }, panic, (initialErrors) => {
        if (initialErrors.length) {
          return next(initialErrors, value);
        }
        this.runTests({
          path,
          value,
          originalValue,
          options,
          tests: this.tests
        }, panic, next);
      });
    }
    /**
     * Executes a set of validations, either schema, produced Tests or a nested
     * schema validate result.
     */
    runTests(runOptions, panic, next) {
      let fired = false;
      let {
        tests,
        value,
        originalValue,
        path,
        options
      } = runOptions;
      let panicOnce = (arg) => {
        if (fired) return;
        fired = true;
        panic(arg, value);
      };
      let nextOnce = (arg) => {
        if (fired) return;
        fired = true;
        next(arg, value);
      };
      let count4 = tests.length;
      let nestedErrors = [];
      if (!count4) return nextOnce([]);
      let args = {
        value,
        originalValue,
        path,
        options,
        schema: this
      };
      for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        test(args, panicOnce, function finishTestRun(err) {
          if (err) {
            Array.isArray(err) ? nestedErrors.push(...err) : nestedErrors.push(err);
          }
          if (--count4 <= 0) {
            nextOnce(nestedErrors);
          }
        });
      }
    }
    asNestedTest({
      key,
      index: index3,
      parent,
      parentPath,
      originalParent,
      options
    }) {
      const k = key != null ? key : index3;
      if (k == null) {
        throw TypeError("Must include `key` or `index` for nested validations");
      }
      const isIndex = typeof k === "number";
      let value = parent[k];
      const testOptions = Object.assign({}, options, {
        // Nested validations fields are always strict:
        //    1. parent isn't strict so the casting will also have cast inner values
        //    2. parent is strict in which case the nested values weren't cast either
        strict: true,
        parent,
        value,
        originalValue: originalParent[k],
        // FIXME: tests depend on `index` being passed around deeply,
        //   we should not let the options.key/index bleed through
        key: void 0,
        // index: undefined,
        [isIndex ? "index" : "key"]: k,
        path: isIndex || k.includes(".") ? `${parentPath || ""}[${isIndex ? k : `"${k}"`}]` : (parentPath ? `${parentPath}.` : "") + key
      });
      return (_, panic, next) => this.resolve(testOptions)._validate(value, testOptions, panic, next);
    }
    validate(value, options) {
      var _options$disableStack2;
      let schema = this.resolve(Object.assign({}, options, {
        value
      }));
      let disableStackTrace = (_options$disableStack2 = options == null ? void 0 : options.disableStackTrace) != null ? _options$disableStack2 : schema.spec.disableStackTrace;
      return new Promise((resolve, reject) => schema._validate(value, options, (error, parsed) => {
        if (ValidationError.isError(error)) error.value = parsed;
        reject(error);
      }, (errors, validated) => {
        if (errors.length) reject(new ValidationError(errors, validated, void 0, void 0, disableStackTrace));
        else resolve(validated);
      }));
    }
    validateSync(value, options) {
      var _options$disableStack3;
      let schema = this.resolve(Object.assign({}, options, {
        value
      }));
      let result;
      let disableStackTrace = (_options$disableStack3 = options == null ? void 0 : options.disableStackTrace) != null ? _options$disableStack3 : schema.spec.disableStackTrace;
      schema._validate(value, Object.assign({}, options, {
        sync: true
      }), (error, parsed) => {
        if (ValidationError.isError(error)) error.value = parsed;
        throw error;
      }, (errors, validated) => {
        if (errors.length) throw new ValidationError(errors, value, void 0, void 0, disableStackTrace);
        result = validated;
      });
      return result;
    }
    isValid(value, options) {
      return this.validate(value, options).then(() => true, (err) => {
        if (ValidationError.isError(err)) return false;
        throw err;
      });
    }
    isValidSync(value, options) {
      try {
        this.validateSync(value, options);
        return true;
      } catch (err) {
        if (ValidationError.isError(err)) return false;
        throw err;
      }
    }
    _getDefault(options) {
      let defaultValue2 = this.spec.default;
      if (defaultValue2 == null) {
        return defaultValue2;
      }
      return typeof defaultValue2 === "function" ? defaultValue2.call(this, options) : clone(defaultValue2);
    }
    getDefault(options) {
      let schema = this.resolve(options || {});
      return schema._getDefault(options);
    }
    default(def) {
      if (arguments.length === 0) {
        return this._getDefault();
      }
      let next = this.clone({
        default: def
      });
      return next;
    }
    strict(isStrict = true) {
      return this.clone({
        strict: isStrict
      });
    }
    nullability(nullable, message) {
      const next = this.clone({
        nullable
      });
      next.internalTests.nullable = createValidation({
        message,
        name: "nullable",
        test(value) {
          return value === null ? this.schema.spec.nullable : true;
        }
      });
      return next;
    }
    optionality(optional, message) {
      const next = this.clone({
        optional
      });
      next.internalTests.optionality = createValidation({
        message,
        name: "optionality",
        test(value) {
          return value === void 0 ? this.schema.spec.optional : true;
        }
      });
      return next;
    }
    optional() {
      return this.optionality(true);
    }
    defined(message = mixed.defined) {
      return this.optionality(false, message);
    }
    nullable() {
      return this.nullability(true);
    }
    nonNullable(message = mixed.notNull) {
      return this.nullability(false, message);
    }
    required(message = mixed.required) {
      return this.clone().withMutation((next) => next.nonNullable(message).defined(message));
    }
    notRequired() {
      return this.clone().withMutation((next) => next.nullable().optional());
    }
    transform(fn) {
      let next = this.clone();
      next.transforms.push(fn);
      return next;
    }
    /**
     * Adds a test function to the schema's queue of tests.
     * tests can be exclusive or non-exclusive.
     *
     * - exclusive tests, will replace any existing tests of the same name.
     * - non-exclusive: can be stacked
     *
     * If a non-exclusive test is added to a schema with an exclusive test of the same name
     * the exclusive test is removed and further tests of the same name will be stacked.
     *
     * If an exclusive test is added to a schema with non-exclusive tests of the same name
     * the previous tests are removed and further tests of the same name will replace each other.
     */
    test(...args) {
      let opts;
      if (args.length === 1) {
        if (typeof args[0] === "function") {
          opts = {
            test: args[0]
          };
        } else {
          opts = args[0];
        }
      } else if (args.length === 2) {
        opts = {
          name: args[0],
          test: args[1]
        };
      } else {
        opts = {
          name: args[0],
          message: args[1],
          test: args[2]
        };
      }
      if (opts.message === void 0) opts.message = mixed.default;
      if (typeof opts.test !== "function") throw new TypeError("`test` is a required parameters");
      let next = this.clone();
      let validate = createValidation(opts);
      let isExclusive = opts.exclusive || opts.name && next.exclusiveTests[opts.name] === true;
      if (opts.exclusive) {
        if (!opts.name) throw new TypeError("Exclusive tests must provide a unique `name` identifying the test");
      }
      if (opts.name) next.exclusiveTests[opts.name] = !!opts.exclusive;
      next.tests = next.tests.filter((fn) => {
        if (fn.OPTIONS.name === opts.name) {
          if (isExclusive) return false;
          if (fn.OPTIONS.test === validate.OPTIONS.test) return false;
        }
        return true;
      });
      next.tests.push(validate);
      return next;
    }
    when(keys, options) {
      if (!Array.isArray(keys) && typeof keys !== "string") {
        options = keys;
        keys = ".";
      }
      let next = this.clone();
      let deps = toArray(keys).map((key) => new Reference(key));
      deps.forEach((dep) => {
        if (dep.isSibling) next.deps.push(dep.key);
      });
      next.conditions.push(typeof options === "function" ? new Condition(deps, options) : Condition.fromOptions(deps, options));
      return next;
    }
    typeError(message) {
      let next = this.clone();
      next.internalTests.typeError = createValidation({
        message,
        name: "typeError",
        skipAbsent: true,
        test(value) {
          if (!this.schema._typeCheck(value)) return this.createError({
            params: {
              type: this.schema.type
            }
          });
          return true;
        }
      });
      return next;
    }
    oneOf(enums, message = mixed.oneOf) {
      let next = this.clone();
      enums.forEach((val) => {
        next._whitelist.add(val);
        next._blacklist.delete(val);
      });
      next.internalTests.whiteList = createValidation({
        message,
        name: "oneOf",
        skipAbsent: true,
        test(value) {
          let valids = this.schema._whitelist;
          let resolved2 = valids.resolveAll(this.resolve);
          return resolved2.includes(value) ? true : this.createError({
            params: {
              values: Array.from(valids).join(", "),
              resolved: resolved2
            }
          });
        }
      });
      return next;
    }
    notOneOf(enums, message = mixed.notOneOf) {
      let next = this.clone();
      enums.forEach((val) => {
        next._blacklist.add(val);
        next._whitelist.delete(val);
      });
      next.internalTests.blacklist = createValidation({
        message,
        name: "notOneOf",
        test(value) {
          let invalids = this.schema._blacklist;
          let resolved2 = invalids.resolveAll(this.resolve);
          if (resolved2.includes(value)) return this.createError({
            params: {
              values: Array.from(invalids).join(", "),
              resolved: resolved2
            }
          });
          return true;
        }
      });
      return next;
    }
    strip(strip = true) {
      let next = this.clone();
      next.spec.strip = strip;
      return next;
    }
    /**
     * Return a serialized description of the schema including validations, flags, types etc.
     *
     * @param options Provide any needed context for resolving runtime schema alterations (lazy, when conditions, etc).
     */
    describe(options) {
      const next = (options ? this.resolve(options) : this).clone();
      const {
        label,
        meta,
        optional,
        nullable
      } = next.spec;
      const description = {
        meta,
        label,
        optional,
        nullable,
        default: next.getDefault(options),
        type: next.type,
        oneOf: next._whitelist.describe(),
        notOneOf: next._blacklist.describe(),
        tests: next.tests.filter((n3, idx, list) => list.findIndex((c3) => c3.OPTIONS.name === n3.OPTIONS.name) === idx).map((fn) => {
          const params = fn.OPTIONS.params && options ? resolveParams(Object.assign({}, fn.OPTIONS.params), options) : fn.OPTIONS.params;
          return {
            name: fn.OPTIONS.name,
            params
          };
        })
      };
      return description;
    }
    get ["~standard"]() {
      const schema = this;
      const standard = {
        version: 1,
        vendor: "yup",
        async validate(value) {
          try {
            const result = await schema.validate(value, {
              abortEarly: false
            });
            return {
              value: result
            };
          } catch (err) {
            if (err instanceof ValidationError) {
              return {
                issues: issuesFromValidationError(err)
              };
            }
            throw err;
          }
        }
      };
      return standard;
    }
  };
  Schema.prototype.__isYupSchema__ = true;
  for (const method of ["validate", "validateSync"]) Schema.prototype[`${method}At`] = function(path, value, options = {}) {
    const {
      parent,
      parentPath,
      schema
    } = getIn(this, path, value, options.context);
    return schema[method](parent && parent[parentPath], Object.assign({}, options, {
      parent,
      path
    }));
  };
  for (const alias of ["equals", "is"]) Schema.prototype[alias] = Schema.prototype.oneOf;
  for (const alias of ["not", "nope"]) Schema.prototype[alias] = Schema.prototype.notOneOf;
  var returnsTrue = () => true;
  function create$8(spec) {
    return new MixedSchema(spec);
  }
  var MixedSchema = class extends Schema {
    constructor(spec) {
      super(typeof spec === "function" ? {
        type: "mixed",
        check: spec
      } : Object.assign({
        type: "mixed",
        check: returnsTrue
      }, spec));
    }
  };
  create$8.prototype = MixedSchema.prototype;
  function create$7() {
    return new BooleanSchema();
  }
  var BooleanSchema = class extends Schema {
    constructor() {
      super({
        type: "boolean",
        check(v) {
          if (v instanceof Boolean) v = v.valueOf();
          return typeof v === "boolean";
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw) => {
          if (this.spec.coerce && !this.isType(value)) {
            if (/^(true|1)$/i.test(String(value))) return true;
            if (/^(false|0)$/i.test(String(value))) return false;
          }
          return value;
        });
      });
    }
    isTrue(message = boolean.isValue) {
      return this.test({
        message,
        name: "is-value",
        exclusive: true,
        params: {
          value: "true"
        },
        test(value) {
          return isAbsent(value) || value === true;
        }
      });
    }
    isFalse(message = boolean.isValue) {
      return this.test({
        message,
        name: "is-value",
        exclusive: true,
        params: {
          value: "false"
        },
        test(value) {
          return isAbsent(value) || value === false;
        }
      });
    }
    default(def) {
      return super.default(def);
    }
    defined(msg) {
      return super.defined(msg);
    }
    optional() {
      return super.optional();
    }
    required(msg) {
      return super.required(msg);
    }
    notRequired() {
      return super.notRequired();
    }
    nullable() {
      return super.nullable();
    }
    nonNullable(msg) {
      return super.nonNullable(msg);
    }
    strip(v) {
      return super.strip(v);
    }
  };
  create$7.prototype = BooleanSchema.prototype;
  var isoReg = /^(\d{4}|[+-]\d{6})(?:-?(\d{2})(?:-?(\d{2}))?)?(?:[ T]?(\d{2}):?(\d{2})(?::?(\d{2})(?:[,.](\d{1,}))?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)?)?$/;
  function parseIsoDate(date2) {
    const struct = parseDateStruct(date2);
    if (!struct) return Date.parse ? Date.parse(date2) : Number.NaN;
    if (struct.z === void 0 && struct.plusMinus === void 0) {
      return new Date(struct.year, struct.month, struct.day, struct.hour, struct.minute, struct.second, struct.millisecond).valueOf();
    }
    let totalMinutesOffset = 0;
    if (struct.z !== "Z" && struct.plusMinus !== void 0) {
      totalMinutesOffset = struct.hourOffset * 60 + struct.minuteOffset;
      if (struct.plusMinus === "+") totalMinutesOffset = 0 - totalMinutesOffset;
    }
    return Date.UTC(struct.year, struct.month, struct.day, struct.hour, struct.minute + totalMinutesOffset, struct.second, struct.millisecond);
  }
  function parseDateStruct(date2) {
    var _regexResult$7$length, _regexResult$;
    const regexResult = isoReg.exec(date2);
    if (!regexResult) return null;
    return {
      year: toNumber(regexResult[1]),
      month: toNumber(regexResult[2], 1) - 1,
      day: toNumber(regexResult[3], 1),
      hour: toNumber(regexResult[4]),
      minute: toNumber(regexResult[5]),
      second: toNumber(regexResult[6]),
      millisecond: regexResult[7] ? (
        // allow arbitrary sub-second precision beyond milliseconds
        toNumber(regexResult[7].substring(0, 3))
      ) : 0,
      precision: (_regexResult$7$length = (_regexResult$ = regexResult[7]) == null ? void 0 : _regexResult$.length) != null ? _regexResult$7$length : void 0,
      z: regexResult[8] || void 0,
      plusMinus: regexResult[9] || void 0,
      hourOffset: toNumber(regexResult[10]),
      minuteOffset: toNumber(regexResult[11])
    };
  }
  function toNumber(str, defaultValue2 = 0) {
    return Number(str) || defaultValue2;
  }
  var rEmail = (
    // eslint-disable-next-line
    /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  );
  var rUrl = (
    // eslint-disable-next-line
    /^((https?|ftp):)?\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?(((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.?)(:\d*)?)(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)?(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i
  );
  var rUUID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
  var yearMonthDay = "^\\d{4}-\\d{2}-\\d{2}";
  var hourMinuteSecond = "\\d{2}:\\d{2}:\\d{2}";
  var zOrOffset = "(([+-]\\d{2}(:?\\d{2})?)|Z)";
  var rIsoDateTime = new RegExp(`${yearMonthDay}T${hourMinuteSecond}(\\.\\d+)?${zOrOffset}$`);
  var isTrimmed = (value) => isAbsent(value) || value === value.trim();
  var objStringTag = {}.toString();
  function create$6() {
    return new StringSchema();
  }
  var StringSchema = class extends Schema {
    constructor() {
      super({
        type: "string",
        check(value) {
          if (value instanceof String) value = value.valueOf();
          return typeof value === "string";
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw) => {
          if (!this.spec.coerce || this.isType(value)) return value;
          if (Array.isArray(value)) return value;
          const strValue = value != null && value.toString ? value.toString() : value;
          if (strValue === objStringTag) return value;
          return strValue;
        });
      });
    }
    required(message) {
      return super.required(message).withMutation((schema) => schema.test({
        message: message || mixed.required,
        name: "required",
        skipAbsent: true,
        test: (value) => !!value.length
      }));
    }
    notRequired() {
      return super.notRequired().withMutation((schema) => {
        schema.tests = schema.tests.filter((t) => t.OPTIONS.name !== "required");
        return schema;
      });
    }
    length(length, message = string.length) {
      return this.test({
        message,
        name: "length",
        exclusive: true,
        params: {
          length
        },
        skipAbsent: true,
        test(value) {
          return value.length === this.resolve(length);
        }
      });
    }
    min(min2, message = string.min) {
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min: min2
        },
        skipAbsent: true,
        test(value) {
          return value.length >= this.resolve(min2);
        }
      });
    }
    max(max2, message = string.max) {
      return this.test({
        name: "max",
        exclusive: true,
        message,
        params: {
          max: max2
        },
        skipAbsent: true,
        test(value) {
          return value.length <= this.resolve(max2);
        }
      });
    }
    matches(regex, options) {
      let excludeEmptyString = false;
      let message;
      let name;
      if (options) {
        if (typeof options === "object") {
          ({
            excludeEmptyString = false,
            message,
            name
          } = options);
        } else {
          message = options;
        }
      }
      return this.test({
        name: name || "matches",
        message: message || string.matches,
        params: {
          regex
        },
        skipAbsent: true,
        test: (value) => value === "" && excludeEmptyString || value.search(regex) !== -1
      });
    }
    email(message = string.email) {
      return this.matches(rEmail, {
        name: "email",
        message,
        excludeEmptyString: true
      });
    }
    url(message = string.url) {
      return this.matches(rUrl, {
        name: "url",
        message,
        excludeEmptyString: true
      });
    }
    uuid(message = string.uuid) {
      return this.matches(rUUID, {
        name: "uuid",
        message,
        excludeEmptyString: false
      });
    }
    datetime(options) {
      let message = "";
      let allowOffset;
      let precision;
      if (options) {
        if (typeof options === "object") {
          ({
            message = "",
            allowOffset = false,
            precision = void 0
          } = options);
        } else {
          message = options;
        }
      }
      return this.matches(rIsoDateTime, {
        name: "datetime",
        message: message || string.datetime,
        excludeEmptyString: true
      }).test({
        name: "datetime_offset",
        message: message || string.datetime_offset,
        params: {
          allowOffset
        },
        skipAbsent: true,
        test: (value) => {
          if (!value || allowOffset) return true;
          const struct = parseDateStruct(value);
          if (!struct) return false;
          return !!struct.z;
        }
      }).test({
        name: "datetime_precision",
        message: message || string.datetime_precision,
        params: {
          precision
        },
        skipAbsent: true,
        test: (value) => {
          if (!value || precision == void 0) return true;
          const struct = parseDateStruct(value);
          if (!struct) return false;
          return struct.precision === precision;
        }
      });
    }
    //-- transforms --
    ensure() {
      return this.default("").transform((val) => val === null ? "" : val);
    }
    trim(message = string.trim) {
      return this.transform((val) => val != null ? val.trim() : val).test({
        message,
        name: "trim",
        test: isTrimmed
      });
    }
    lowercase(message = string.lowercase) {
      return this.transform((value) => !isAbsent(value) ? value.toLowerCase() : value).test({
        message,
        name: "string_case",
        exclusive: true,
        skipAbsent: true,
        test: (value) => isAbsent(value) || value === value.toLowerCase()
      });
    }
    uppercase(message = string.uppercase) {
      return this.transform((value) => !isAbsent(value) ? value.toUpperCase() : value).test({
        message,
        name: "string_case",
        exclusive: true,
        skipAbsent: true,
        test: (value) => isAbsent(value) || value === value.toUpperCase()
      });
    }
  };
  create$6.prototype = StringSchema.prototype;
  var isNaN$1 = (value) => value != +value;
  function create$5() {
    return new NumberSchema();
  }
  var NumberSchema = class extends Schema {
    constructor() {
      super({
        type: "number",
        check(value) {
          if (value instanceof Number) value = value.valueOf();
          return typeof value === "number" && !isNaN$1(value);
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw) => {
          if (!this.spec.coerce) return value;
          let parsed = value;
          if (typeof parsed === "string") {
            parsed = parsed.replace(/\s/g, "");
            if (parsed === "") return NaN;
            parsed = +parsed;
          }
          if (this.isType(parsed) || parsed === null) return parsed;
          return parseFloat(parsed);
        });
      });
    }
    min(min2, message = number.min) {
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min: min2
        },
        skipAbsent: true,
        test(value) {
          return value >= this.resolve(min2);
        }
      });
    }
    max(max2, message = number.max) {
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          max: max2
        },
        skipAbsent: true,
        test(value) {
          return value <= this.resolve(max2);
        }
      });
    }
    lessThan(less, message = number.lessThan) {
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          less
        },
        skipAbsent: true,
        test(value) {
          return value < this.resolve(less);
        }
      });
    }
    moreThan(more, message = number.moreThan) {
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          more
        },
        skipAbsent: true,
        test(value) {
          return value > this.resolve(more);
        }
      });
    }
    positive(msg = number.positive) {
      return this.moreThan(0, msg);
    }
    negative(msg = number.negative) {
      return this.lessThan(0, msg);
    }
    integer(message = number.integer) {
      return this.test({
        name: "integer",
        message,
        skipAbsent: true,
        test: (val) => Number.isInteger(val)
      });
    }
    truncate() {
      return this.transform((value) => !isAbsent(value) ? value | 0 : value);
    }
    round(method) {
      var _method;
      let avail = ["ceil", "floor", "round", "trunc"];
      method = ((_method = method) == null ? void 0 : _method.toLowerCase()) || "round";
      if (method === "trunc") return this.truncate();
      if (avail.indexOf(method.toLowerCase()) === -1) throw new TypeError("Only valid options for round() are: " + avail.join(", "));
      return this.transform((value) => !isAbsent(value) ? Math[method](value) : value);
    }
  };
  create$5.prototype = NumberSchema.prototype;
  var invalidDate = /* @__PURE__ */ new Date("");
  var isDate = (obj) => Object.prototype.toString.call(obj) === "[object Date]";
  function create$4() {
    return new DateSchema();
  }
  var DateSchema = class _DateSchema extends Schema {
    constructor() {
      super({
        type: "date",
        check(v) {
          return isDate(v) && !isNaN(v.getTime());
        }
      });
      this.withMutation(() => {
        this.transform((value, _raw) => {
          if (!this.spec.coerce || this.isType(value) || value === null) return value;
          value = parseIsoDate(value);
          return !isNaN(value) ? new Date(value) : _DateSchema.INVALID_DATE;
        });
      });
    }
    prepareParam(ref, name) {
      let param;
      if (!Reference.isRef(ref)) {
        let cast = this.cast(ref);
        if (!this._typeCheck(cast)) throw new TypeError(`\`${name}\` must be a Date or a value that can be \`cast()\` to a Date`);
        param = cast;
      } else {
        param = ref;
      }
      return param;
    }
    min(min2, message = date.min) {
      let limit = this.prepareParam(min2, "min");
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min: min2
        },
        skipAbsent: true,
        test(value) {
          return value >= this.resolve(limit);
        }
      });
    }
    max(max2, message = date.max) {
      let limit = this.prepareParam(max2, "max");
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          max: max2
        },
        skipAbsent: true,
        test(value) {
          return value <= this.resolve(limit);
        }
      });
    }
  };
  DateSchema.INVALID_DATE = invalidDate;
  create$4.prototype = DateSchema.prototype;
  create$4.INVALID_DATE = invalidDate;
  function sortFields(fields, excludedEdges = []) {
    let edges = [];
    let nodes = /* @__PURE__ */ new Set();
    let excludes = new Set(excludedEdges.map(([a8, b]) => `${a8}-${b}`));
    function addNode(depPath, key) {
      let node = (0, import_property_expr.split)(depPath)[0];
      nodes.add(node);
      if (!excludes.has(`${key}-${node}`)) edges.push([key, node]);
    }
    for (const key of Object.keys(fields)) {
      let value = fields[key];
      nodes.add(key);
      if (Reference.isRef(value) && value.isSibling) addNode(value.path, key);
      else if (isSchema(value) && "deps" in value) value.deps.forEach((path) => addNode(path, key));
    }
    return import_toposort.default.array(Array.from(nodes), edges).reverse();
  }
  function findIndex(arr, err) {
    let idx = Infinity;
    arr.some((key, ii) => {
      var _err$path;
      if ((_err$path = err.path) != null && _err$path.includes(key)) {
        idx = ii;
        return true;
      }
    });
    return idx;
  }
  function sortByKeyOrder(keys) {
    return (a8, b) => {
      return findIndex(keys, a8) - findIndex(keys, b);
    };
  }
  var parseJson = (value, _, schema) => {
    if (typeof value !== "string") {
      return value;
    }
    let parsed = value;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
    }
    return schema.isType(parsed) ? parsed : value;
  };
  function deepPartial(schema) {
    if ("fields" in schema) {
      const partial = {};
      for (const [key, fieldSchema] of Object.entries(schema.fields)) {
        partial[key] = deepPartial(fieldSchema);
      }
      return schema.setFields(partial);
    }
    if (schema.type === "array") {
      const nextArray = schema.optional();
      if (nextArray.innerType) nextArray.innerType = deepPartial(nextArray.innerType);
      return nextArray;
    }
    if (schema.type === "tuple") {
      return schema.optional().clone({
        types: schema.spec.types.map(deepPartial)
      });
    }
    if ("optional" in schema) {
      return schema.optional();
    }
    return schema;
  }
  var deepHas = (obj, p2) => {
    const path = [...(0, import_property_expr.normalizePath)(p2)];
    if (path.length === 1) return path[0] in obj;
    let last = path.pop();
    let parent = (0, import_property_expr.getter)((0, import_property_expr.join)(path), true)(obj);
    return !!(parent && last in parent);
  };
  var isObject = (obj) => Object.prototype.toString.call(obj) === "[object Object]";
  function unknown(ctx, value) {
    let known = Object.keys(ctx.fields);
    return Object.keys(value).filter((key) => known.indexOf(key) === -1);
  }
  var defaultSort = sortByKeyOrder([]);
  function create$3(spec) {
    return new ObjectSchema(spec);
  }
  var ObjectSchema = class extends Schema {
    constructor(spec) {
      super({
        type: "object",
        check(value) {
          return isObject(value) || typeof value === "function";
        }
      });
      this.fields = /* @__PURE__ */ Object.create(null);
      this._sortErrors = defaultSort;
      this._nodes = [];
      this._excludedEdges = [];
      this.withMutation(() => {
        if (spec) {
          this.shape(spec);
        }
      });
    }
    _cast(_value, options = {}) {
      var _options$stripUnknown;
      let value = super._cast(_value, options);
      if (value === void 0) return this.getDefault(options);
      if (!this._typeCheck(value)) return value;
      let fields = this.fields;
      let strip = (_options$stripUnknown = options.stripUnknown) != null ? _options$stripUnknown : this.spec.noUnknown;
      let props = [].concat(this._nodes, Object.keys(value).filter((v) => !this._nodes.includes(v)));
      let intermediateValue = {};
      let innerOptions = Object.assign({}, options, {
        parent: intermediateValue,
        __validating: options.__validating || false
      });
      let isChanged = false;
      for (const prop of props) {
        let field = fields[prop];
        let exists = prop in value;
        let inputValue = value[prop];
        if (field) {
          let fieldValue;
          innerOptions.path = (options.path ? `${options.path}.` : "") + prop;
          field = field.resolve({
            value: inputValue,
            context: options.context,
            parent: intermediateValue
          });
          let fieldSpec = field instanceof Schema ? field.spec : void 0;
          let strict = fieldSpec == null ? void 0 : fieldSpec.strict;
          if (fieldSpec != null && fieldSpec.strip) {
            isChanged = isChanged || prop in value;
            continue;
          }
          fieldValue = !options.__validating || !strict ? field.cast(inputValue, innerOptions) : inputValue;
          if (fieldValue !== void 0) {
            intermediateValue[prop] = fieldValue;
          }
        } else if (exists && !strip) {
          intermediateValue[prop] = inputValue;
        }
        if (exists !== prop in intermediateValue || intermediateValue[prop] !== inputValue) {
          isChanged = true;
        }
      }
      return isChanged ? intermediateValue : value;
    }
    _validate(_value, options = {}, panic, next) {
      let {
        from = [],
        originalValue = _value,
        recursive = this.spec.recursive
      } = options;
      options.from = [{
        schema: this,
        value: originalValue
      }, ...from];
      options.__validating = true;
      options.originalValue = originalValue;
      super._validate(_value, options, panic, (objectErrors, value) => {
        if (!recursive || !isObject(value)) {
          next(objectErrors, value);
          return;
        }
        originalValue = originalValue || value;
        let tests = [];
        for (let key of this._nodes) {
          let field = this.fields[key];
          if (!field || Reference.isRef(field)) {
            continue;
          }
          tests.push(field.asNestedTest({
            options,
            key,
            parent: value,
            parentPath: options.path,
            originalParent: originalValue
          }));
        }
        this.runTests({
          tests,
          value,
          originalValue,
          options
        }, panic, (fieldErrors) => {
          next(fieldErrors.sort(this._sortErrors).concat(objectErrors), value);
        });
      });
    }
    clone(spec) {
      const next = super.clone(spec);
      next.fields = Object.assign({}, this.fields);
      next._nodes = this._nodes;
      next._excludedEdges = this._excludedEdges;
      next._sortErrors = this._sortErrors;
      return next;
    }
    concat(schema) {
      let next = super.concat(schema);
      let nextFields = next.fields;
      for (let [field, schemaOrRef] of Object.entries(this.fields)) {
        const target = nextFields[field];
        nextFields[field] = target === void 0 ? schemaOrRef : target;
      }
      return next.withMutation((s4) => (
        // XXX: excludes here is wrong
        s4.setFields(nextFields, [...this._excludedEdges, ...schema._excludedEdges])
      ));
    }
    _getDefault(options) {
      if ("default" in this.spec) {
        return super._getDefault(options);
      }
      if (!this._nodes.length) {
        return void 0;
      }
      let dft = {};
      this._nodes.forEach((key) => {
        var _innerOptions;
        const field = this.fields[key];
        let innerOptions = options;
        if ((_innerOptions = innerOptions) != null && _innerOptions.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[key]
          });
        }
        dft[key] = field && "getDefault" in field ? field.getDefault(innerOptions) : void 0;
      });
      return dft;
    }
    setFields(shape, excludedEdges) {
      let next = this.clone();
      next.fields = shape;
      next._nodes = sortFields(shape, excludedEdges);
      next._sortErrors = sortByKeyOrder(Object.keys(shape));
      if (excludedEdges) next._excludedEdges = excludedEdges;
      return next;
    }
    shape(additions, excludes = []) {
      return this.clone().withMutation((next) => {
        let edges = next._excludedEdges;
        if (excludes.length) {
          if (!Array.isArray(excludes[0])) excludes = [excludes];
          edges = [...next._excludedEdges, ...excludes];
        }
        return next.setFields(Object.assign(next.fields, additions), edges);
      });
    }
    partial() {
      const partial = {};
      for (const [key, schema] of Object.entries(this.fields)) {
        partial[key] = "optional" in schema && schema.optional instanceof Function ? schema.optional() : schema;
      }
      return this.setFields(partial);
    }
    deepPartial() {
      const next = deepPartial(this);
      return next;
    }
    pick(keys) {
      const picked = {};
      for (const key of keys) {
        if (this.fields[key]) picked[key] = this.fields[key];
      }
      return this.setFields(picked, this._excludedEdges.filter(([a8, b]) => keys.includes(a8) && keys.includes(b)));
    }
    omit(keys) {
      const remaining = [];
      for (const key of Object.keys(this.fields)) {
        if (keys.includes(key)) continue;
        remaining.push(key);
      }
      return this.pick(remaining);
    }
    from(from, to, alias) {
      let fromGetter = (0, import_property_expr.getter)(from, true);
      return this.transform((obj) => {
        if (!obj) return obj;
        let newObj = obj;
        if (deepHas(obj, from)) {
          newObj = Object.assign({}, obj);
          if (!alias) delete newObj[from];
          newObj[to] = fromGetter(obj);
        }
        return newObj;
      });
    }
    /** Parse an input JSON string to an object */
    json() {
      return this.transform(parseJson);
    }
    /**
     * Similar to `noUnknown` but only validates that an object is the right shape without stripping the unknown keys
     */
    exact(message) {
      return this.test({
        name: "exact",
        exclusive: true,
        message: message || object.exact,
        test(value) {
          if (value == null) return true;
          const unknownKeys = unknown(this.schema, value);
          return unknownKeys.length === 0 || this.createError({
            params: {
              properties: unknownKeys.join(", ")
            }
          });
        }
      });
    }
    stripUnknown() {
      return this.clone({
        noUnknown: true
      });
    }
    noUnknown(noAllow = true, message = object.noUnknown) {
      if (typeof noAllow !== "boolean") {
        message = noAllow;
        noAllow = true;
      }
      let next = this.test({
        name: "noUnknown",
        exclusive: true,
        message,
        test(value) {
          if (value == null) return true;
          const unknownKeys = unknown(this.schema, value);
          return !noAllow || unknownKeys.length === 0 || this.createError({
            params: {
              unknown: unknownKeys.join(", ")
            }
          });
        }
      });
      next.spec.noUnknown = noAllow;
      return next;
    }
    unknown(allow = true, message = object.noUnknown) {
      return this.noUnknown(!allow, message);
    }
    transformKeys(fn) {
      return this.transform((obj) => {
        if (!obj) return obj;
        const result = {};
        for (const key of Object.keys(obj)) result[fn(key)] = obj[key];
        return result;
      });
    }
    camelCase() {
      return this.transformKeys(import_tiny_case.camelCase);
    }
    snakeCase() {
      return this.transformKeys(import_tiny_case.snakeCase);
    }
    constantCase() {
      return this.transformKeys((key) => (0, import_tiny_case.snakeCase)(key).toUpperCase());
    }
    describe(options) {
      const next = (options ? this.resolve(options) : this).clone();
      const base = super.describe(options);
      base.fields = {};
      for (const [key, value] of Object.entries(next.fields)) {
        var _innerOptions2;
        let innerOptions = options;
        if ((_innerOptions2 = innerOptions) != null && _innerOptions2.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[key]
          });
        }
        base.fields[key] = value.describe(innerOptions);
      }
      return base;
    }
  };
  create$3.prototype = ObjectSchema.prototype;
  function create$2(type) {
    return new ArraySchema(type);
  }
  var ArraySchema = class extends Schema {
    constructor(type) {
      super({
        type: "array",
        spec: {
          types: type
        },
        check(v) {
          return Array.isArray(v);
        }
      });
      this.innerType = void 0;
      this.innerType = type;
    }
    _cast(_value, _opts) {
      const value = super._cast(_value, _opts);
      if (!this._typeCheck(value) || !this.innerType) {
        return value;
      }
      let isChanged = false;
      const castArray = value.map((v, idx) => {
        const castElement = this.innerType.cast(v, Object.assign({}, _opts, {
          path: `${_opts.path || ""}[${idx}]`,
          parent: value,
          originalValue: v,
          value: v,
          index: idx
        }));
        if (castElement !== v) {
          isChanged = true;
        }
        return castElement;
      });
      return isChanged ? castArray : value;
    }
    _validate(_value, options = {}, panic, next) {
      var _options$recursive;
      let innerType = this.innerType;
      let recursive = (_options$recursive = options.recursive) != null ? _options$recursive : this.spec.recursive;
      options.originalValue != null ? options.originalValue : _value;
      super._validate(_value, options, panic, (arrayErrors, value) => {
        var _options$originalValu2;
        if (!recursive || !innerType || !this._typeCheck(value)) {
          next(arrayErrors, value);
          return;
        }
        let tests = new Array(value.length);
        for (let index3 = 0; index3 < value.length; index3++) {
          var _options$originalValu;
          tests[index3] = innerType.asNestedTest({
            options,
            index: index3,
            parent: value,
            parentPath: options.path,
            originalParent: (_options$originalValu = options.originalValue) != null ? _options$originalValu : _value
          });
        }
        this.runTests({
          value,
          tests,
          originalValue: (_options$originalValu2 = options.originalValue) != null ? _options$originalValu2 : _value,
          options
        }, panic, (innerTypeErrors) => next(innerTypeErrors.concat(arrayErrors), value));
      });
    }
    clone(spec) {
      const next = super.clone(spec);
      next.innerType = this.innerType;
      return next;
    }
    /** Parse an input JSON string to an object */
    json() {
      return this.transform(parseJson);
    }
    concat(schema) {
      let next = super.concat(schema);
      next.innerType = this.innerType;
      if (schema.innerType)
        next.innerType = next.innerType ? (
          // @ts-expect-error Lazy doesn't have concat and will break
          next.innerType.concat(schema.innerType)
        ) : schema.innerType;
      return next;
    }
    of(schema) {
      let next = this.clone();
      if (!isSchema(schema)) throw new TypeError("`array.of()` sub-schema must be a valid yup schema not: " + printValue(schema));
      next.innerType = schema;
      next.spec = Object.assign({}, next.spec, {
        types: schema
      });
      return next;
    }
    length(length, message = array.length) {
      return this.test({
        message,
        name: "length",
        exclusive: true,
        params: {
          length
        },
        skipAbsent: true,
        test(value) {
          return value.length === this.resolve(length);
        }
      });
    }
    min(min2, message) {
      message = message || array.min;
      return this.test({
        message,
        name: "min",
        exclusive: true,
        params: {
          min: min2
        },
        skipAbsent: true,
        // FIXME(ts): Array<typeof T>
        test(value) {
          return value.length >= this.resolve(min2);
        }
      });
    }
    max(max2, message) {
      message = message || array.max;
      return this.test({
        message,
        name: "max",
        exclusive: true,
        params: {
          max: max2
        },
        skipAbsent: true,
        test(value) {
          return value.length <= this.resolve(max2);
        }
      });
    }
    ensure() {
      return this.default(() => []).transform((val, original) => {
        if (this._typeCheck(val)) return val;
        return original == null ? [] : [].concat(original);
      });
    }
    compact(rejector) {
      let reject = !rejector ? (v) => !!v : (v, i, a8) => !rejector(v, i, a8);
      return this.transform((values) => values != null ? values.filter(reject) : values);
    }
    describe(options) {
      const next = (options ? this.resolve(options) : this).clone();
      const base = super.describe(options);
      if (next.innerType) {
        var _innerOptions;
        let innerOptions = options;
        if ((_innerOptions = innerOptions) != null && _innerOptions.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[0]
          });
        }
        base.innerType = next.innerType.describe(innerOptions);
      }
      return base;
    }
  };
  create$2.prototype = ArraySchema.prototype;
  function create$1(schemas) {
    return new TupleSchema(schemas);
  }
  var TupleSchema = class extends Schema {
    constructor(schemas) {
      super({
        type: "tuple",
        spec: {
          types: schemas
        },
        check(v) {
          const types = this.spec.types;
          return Array.isArray(v) && v.length === types.length;
        }
      });
      this.withMutation(() => {
        this.typeError(tuple.notType);
      });
    }
    _cast(inputValue, options) {
      const {
        types
      } = this.spec;
      const value = super._cast(inputValue, options);
      if (!this._typeCheck(value)) {
        return value;
      }
      let isChanged = false;
      const castArray = types.map((type, idx) => {
        const castElement = type.cast(value[idx], Object.assign({}, options, {
          path: `${options.path || ""}[${idx}]`,
          parent: value,
          originalValue: value[idx],
          value: value[idx],
          index: idx
        }));
        if (castElement !== value[idx]) isChanged = true;
        return castElement;
      });
      return isChanged ? castArray : value;
    }
    _validate(_value, options = {}, panic, next) {
      let itemTypes = this.spec.types;
      super._validate(_value, options, panic, (tupleErrors, value) => {
        var _options$originalValu2;
        if (!this._typeCheck(value)) {
          next(tupleErrors, value);
          return;
        }
        let tests = [];
        for (let [index3, itemSchema] of itemTypes.entries()) {
          var _options$originalValu;
          tests[index3] = itemSchema.asNestedTest({
            options,
            index: index3,
            parent: value,
            parentPath: options.path,
            originalParent: (_options$originalValu = options.originalValue) != null ? _options$originalValu : _value
          });
        }
        this.runTests({
          value,
          tests,
          originalValue: (_options$originalValu2 = options.originalValue) != null ? _options$originalValu2 : _value,
          options
        }, panic, (innerTypeErrors) => next(innerTypeErrors.concat(tupleErrors), value));
      });
    }
    describe(options) {
      const next = (options ? this.resolve(options) : this).clone();
      const base = super.describe(options);
      base.innerType = next.spec.types.map((schema, index3) => {
        var _innerOptions;
        let innerOptions = options;
        if ((_innerOptions = innerOptions) != null && _innerOptions.value) {
          innerOptions = Object.assign({}, innerOptions, {
            parent: innerOptions.value,
            value: innerOptions.value[index3]
          });
        }
        return schema.describe(innerOptions);
      });
      return base;
    }
  };
  create$1.prototype = TupleSchema.prototype;
  function addMethod(schemaType, name, fn) {
    if (!schemaType || !isSchema(schemaType.prototype)) throw new TypeError("You must provide a yup schema constructor function");
    if (typeof name !== "string") throw new TypeError("A Method name must be provided");
    if (typeof fn !== "function") throw new TypeError("Method function must be provided");
    schemaType.prototype[name] = fn;
  }

  // ../stack-shared/dist/esm/utils/currency-constants.js
  var SUPPORTED_CURRENCIES = [
    {
      code: "USD",
      decimals: 2,
      stripeDecimals: 2
    },
    {
      code: "EUR",
      decimals: 2,
      stripeDecimals: 2
    },
    {
      code: "GBP",
      decimals: 2,
      stripeDecimals: 2
    },
    {
      code: "JPY",
      decimals: 0,
      stripeDecimals: 0
    },
    {
      code: "INR",
      decimals: 2,
      stripeDecimals: 2
    },
    {
      code: "AUD",
      decimals: 2,
      stripeDecimals: 2
    },
    {
      code: "CAD",
      decimals: 2,
      stripeDecimals: 2
    }
  ];

  // ../stack-shared/dist/esm/utils/http.js
  function decodeBasicAuthorizationHeader(value) {
    const [type, encoded, ...rest] = value.split(" ");
    if (rest.length > 0) return null;
    if (!encoded) return null;
    if (type !== "Basic") return null;
    if (!isBase64(encoded)) return null;
    const split2 = new TextDecoder().decode(decodeBase64(encoded)).split(":");
    return [split2[0], split2.slice(1).join(":")];
  }

  // ../stack-shared/dist/esm/utils/oauth.js
  var standardProviders = [
    "google",
    "github",
    "microsoft",
    "spotify",
    "facebook",
    "discord",
    "gitlab",
    "bitbucket",
    "linkedin",
    "apple",
    "x",
    "twitch"
  ];
  var allProviders = standardProviders;

  // ../stack-shared/dist/esm/utils/uuids.js
  function generateUuid() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c3) => (+c3 ^ generateRandomValues(new Uint8Array(1))[0] & 15 >> +c3 / 4).toString(16));
  }
  function isUuid(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str);
  }

  // ../stack-shared/dist/esm/schema-fields.js
  var MAX_IMAGE_SIZE_BASE64_BYTES = 1e6;
  addMethod(create$6, "nonEmpty", function(message) {
    return this.test("non-empty", message ?? (({ path }) => `${path} must not be empty`), (value) => {
      return value !== "";
    });
  });
  addMethod(Schema, "hasNested", function(path) {
    if (!path.match(/^[a-zA-Z0-9_$:-]*$/)) throw new StackAssertionError(`yupSchema.hasNested can currently only be used with alphanumeric keys, underscores, dollar signs, colons, and hyphens. Fix this in the future. Provided key: ${JSON.stringify(path)}`);
    const schemaInfo = this.meta()?.stackSchemaInfo;
    if (schemaInfo?.type === "record") return schemaInfo.keySchema.isValidSync(path);
    else if (schemaInfo?.type === "union") return schemaInfo.items.some((s4) => s4.hasNested(path));
    else try {
      reach(this, path);
      return true;
    } catch (e15) {
      if (e15 instanceof Error && e15.message.includes("The schema does not contain the path")) return false;
      throw e15;
    }
  });
  addMethod(Schema, "getNested", function(path) {
    if (!path.match(/^[a-zA-Z0-9_$:-]*$/)) throw new StackAssertionError(`yupSchema.getNested can currently only be used with alphanumeric keys, underscores, dollar signs, colons, and hyphens. Fix this in the future. Provided key: ${JSON.stringify(path)}`);
    if (!this.hasNested(path)) throw new StackAssertionError(`Tried to call yupSchema.getNested, but key is not present in the schema. Provided key: ${path}`, {
      path,
      schema: this
    });
    const schemaInfo = this.meta()?.stackSchemaInfo;
    if (schemaInfo?.type === "record") return schemaInfo.valueSchema;
    else if (schemaInfo?.type === "union") return yupUnion(...schemaInfo.items.filter((s4) => s4.hasNested(path)).map((s4) => s4.getNested(path)));
    else return reach(this, path);
  });
  async function yupValidate(schema, obj, options) {
    try {
      return await schema.validate(obj, {
        ...omit(options ?? {}, ["currentUserId"]),
        context: {
          ...options?.context,
          stackAllowUserIdMe: options?.currentUserId !== void 0
        }
      });
    } catch (error) {
      if (error instanceof ReplaceFieldWithOwnUserId) {
        const currentUserId = options?.currentUserId;
        if (!currentUserId) throw new KnownErrors.CannotGetOwnUserWithoutUser();
        let pathRemaining = error.path;
        const fieldPath = [];
        while (pathRemaining.length > 0) if (pathRemaining.startsWith("[")) {
          const index3 = pathRemaining.indexOf("]");
          if (index3 < 0) throw new StackAssertionError("Invalid path");
          fieldPath.push(JSON.parse(pathRemaining.slice(1, index3)));
          pathRemaining = pathRemaining.slice(index3 + 1);
        } else {
          let dotIndex = pathRemaining.indexOf(".");
          if (dotIndex === -1) dotIndex = pathRemaining.length;
          fieldPath.push(pathRemaining.slice(0, dotIndex));
          pathRemaining = pathRemaining.slice(dotIndex + 1);
        }
        const newObj = deepPlainClone(obj);
        let it = newObj;
        for (const field of fieldPath.slice(0, -1)) {
          if (!Object.prototype.hasOwnProperty.call(it, field)) throw new StackAssertionError(`Segment ${field} of path ${error.path} not found in object`);
          it = it[field];
        }
        it[fieldPath[fieldPath.length - 1]] = currentUserId;
        return await yupValidate(schema, newObj, options);
      }
      throw error;
    }
  }
  var _idDescription = (identify) => `The unique identifier of the ${identify}`;
  var _displayNameDescription = (identify) => `Human-readable ${identify} display name. This is not a unique identifier.`;
  var _clientMetaDataDescription = (identify) => `Client metadata. Used as a data store, accessible from the client side. Do not store information that should not be exposed to the client.`;
  var _clientReadOnlyMetaDataDescription = (identify) => `Client read-only, server-writable metadata. Used as a data store, accessible from the client side. Do not store information that should not be exposed to the client. The client can read this data, but cannot modify it. This is useful for things like subscription status.`;
  var _profileImageUrlDescription = (identify) => `URL of the profile image for ${identify}. Can be a Base64 encoded image. Must be smaller than 100KB. Please compress and crop to a square before passing in.`;
  var _serverMetaDataDescription = (identify) => `Server metadata. Used as a data store, only accessible from the server side. You can store secret information related to the ${identify} here.`;
  var _atMillisDescription = (identify) => `(the number of milliseconds since epoch, January 1, 1970, UTC)`;
  var _createdAtMillisDescription = (identify) => `The time the ${identify} was created ${_atMillisDescription(identify)}`;
  var _signedUpAtMillisDescription = `The time the user signed up ${_atMillisDescription}`;
  var _lastActiveAtMillisDescription = `The time the user was last active ${_atMillisDescription}`;
  function yupString(...args) {
    return create$6(...args).meta({ stackSchemaInfo: { type: "string" } });
  }
  function yupNumber(...args) {
    return create$5(...args).meta({ stackSchemaInfo: { type: "number" } });
  }
  function yupBoolean(...args) {
    return create$7(...args).meta({ stackSchemaInfo: { type: "boolean" } });
  }
  function _yupMixedInternal(...args) {
    return create$8(...args);
  }
  function yupMixed(...args) {
    return _yupMixedInternal(...args).meta({ stackSchemaInfo: { type: "mixed" } });
  }
  function yupArray(...args) {
    return create$2(...args).meta({ stackSchemaInfo: { type: "array" } });
  }
  function yupTuple(schemas) {
    if (schemas.length === 0) throw new Error("yupTuple must have at least one schema");
    return create$1(schemas).meta({ stackSchemaInfo: {
      type: "tuple",
      items: schemas
    } });
  }
  function yupObjectWithAutoDefault(...args) {
    return create$3(...args).test("no-unknown-object-properties", ({ path }) => `${path} contains unknown properties`, (value, context) => {
      if (context.options.context?.noUnknownPathPrefixes?.some((prefix) => context.path.startsWith(prefix))) {
        if (context.schema.spec.noUnknown !== false) {
          const availableKeys = new Set(Object.keys(context.schema.fields));
          const unknownKeys = Object.keys(value ?? {}).filter((key) => !availableKeys.has(key));
          if (unknownKeys.length > 0) return context.createError({
            message: `${context.path || "Object"} contains unknown properties: ${unknownKeys.join(", ")}`,
            path: context.path,
            params: {
              unknownKeys,
              availableKeys
            }
          });
        }
      }
      return true;
    }).meta({ stackSchemaInfo: { type: "object" } });
  }
  function yupObject(...args) {
    return yupObjectWithAutoDefault(...args).default(void 0);
  }
  function yupUnion(...args) {
    if (args.length === 0) throw new Error("yupUnion must have at least one schema");
    return _yupMixedInternal().meta({ stackSchemaInfo: {
      type: "union",
      items: args
    } }).test("is-one-of", "Invalid value", async (value, context) => {
      if (value == null) return true;
      const errors = [];
      for (const schema of args) try {
        await yupValidate(schema, value, context.options);
        return true;
      } catch (e15) {
        errors.push(e15);
      }
      return context.createError({
        message: deindent`
        ${context.path} is not matched by any of the provided schemas:
          ${errors.map((e15, i) => deindent`
            Schema ${i}:
              ${e15.errors.join("\n")}
          `).join("\n")}`,
        path: context.path
      });
    });
  }
  function yupRecord(keySchema, valueSchema) {
    return yupObject().meta({ stackSchemaInfo: {
      type: "record",
      keySchema,
      valueSchema
    } }).unknown(true).test("record", "${path} must be a record of valid values", async function(value, context) {
      if (value == null) return true;
      const { path, createError } = this;
      if (typeof value !== "object") return createError({ message: `${path} must be an object` });
      for (const key of Object.keys(value)) {
        await yupValidate(keySchema, key, context.options);
        try {
          await yupValidate(valueSchema, value[key], {
            ...context.options,
            context: {
              ...context.options.context,
              path: path ? `${path}.${key}` : key
            }
          });
        } catch (e15) {
          return createError({
            path: path ? `${path}.${key}` : key,
            message: e15.message
          });
        }
      }
      return true;
    });
  }
  var adaptSchema = yupMixed();
  var urlSchema = yupString().test({
    name: "no-spaces",
    message: (params) => `${params.path} contains spaces`,
    test: (value) => value == null || !value.includes(" ")
  }).test({
    name: "url",
    message: (params) => `${params.path} is not a valid URL`,
    test: (value) => value == null || isValidUrl(value)
  });
  var wildcardUrlSchema = yupString().test({
    name: "no-spaces",
    message: (params) => `${params.path} contains spaces`,
    test: (value) => value == null || !value.includes(" ")
  }).test({
    name: "wildcard-url",
    message: (params) => `${params.path} is not a valid URL or wildcard URL pattern`,
    test: (value) => {
      if (value == null) return true;
      if (!value.includes("*")) return isValidUrl(value);
      try {
        const PLACEHOLDER = "wildcard-placeholder";
        const normalizedUrl = value.replace(/\*/g, PLACEHOLDER);
        const url = new URL(normalizedUrl);
        if (url.username.includes(PLACEHOLDER) || url.password.includes(PLACEHOLDER) || url.pathname.includes(PLACEHOLDER) || url.search.includes(PLACEHOLDER) || url.hash.includes(PLACEHOLDER)) return false;
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        return isValidHostnameWithWildcards(url.hostname.split(PLACEHOLDER).join("*"));
      } catch (e15) {
        return false;
      }
    }
  });
  var wildcardProtocolAndDomainSchema = wildcardUrlSchema.test({
    name: "is-protocol-and-domain",
    message: (params) => `${params.path} must be a protocol and domain (with optional port) without any path, query parameters, or hash`,
    test: (value) => {
      if (value == null) return true;
      try {
        const normalized = value.replace(/\*/g, "wildcard-placeholder");
        const url = new URL(normalized);
        return url.protocol !== "" && url.hostname !== "" && url.pathname === "/" && url.search === "" && url.hash === "";
      } catch (e15) {
        return false;
      }
    }
  });
  var jsonSchema = yupMixed().nullable().defined().transform((value) => JSON.parse(JSON.stringify(value)));
  var jsonStringSchema = yupString().test("json", (params) => `${params.path} is not valid JSON`, (value) => {
    if (value == null) return true;
    try {
      JSON.parse(value);
      return true;
    } catch (error) {
      return false;
    }
  });
  var jsonStringOrEmptySchema = yupString().test("json", (params) => `${params.path} is not valid JSON`, (value) => {
    if (!value) return true;
    try {
      JSON.parse(value);
      return true;
    } catch (error) {
      return false;
    }
  });
  var base64Schema = yupString().test("is-base64", (params) => `${params.path} is not valid base64`, (value) => {
    if (value == null) return true;
    return isBase64(value);
  });
  var passwordSchema = yupString().max(70);
  var intervalSchema = yupTuple([yupNumber().min(0).integer().defined(), yupString().oneOf([
    "millisecond",
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "year"
  ]).defined()]);
  var dayIntervalSchema = yupTuple([yupNumber().min(0).integer().defined(), yupString().oneOf([
    "day",
    "week",
    "month",
    "year"
  ]).defined()]);
  var intervalOrNeverSchema = yupUnion(intervalSchema.defined(), yupString().oneOf(["never"]).defined());
  var dayIntervalOrNeverSchema = yupUnion(dayIntervalSchema.defined(), yupString().oneOf(["never"]).defined());
  var USER_SPECIFIED_ID_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/;
  var USER_SPECIFIED_ID_MAX_LENGTH = 63;
  function getUserSpecifiedIdErrorMessage(idName) {
    return `${idName} must contain only letters, numbers, underscores, and hyphens, and not start with a hyphen`;
  }
  var userSpecifiedIdSchema = (idName) => yupString().max(USER_SPECIFIED_ID_MAX_LENGTH).matches(USER_SPECIFIED_ID_PATTERN, getUserSpecifiedIdErrorMessage(idName));
  var moneyAmountSchema = (currency) => yupString().test("money-amount", "Invalid money amount", (value, context) => {
    if (value == null) return true;
    const match = value.match(/^([0-9]+)(\.([0-9]+))?$/);
    if (!match) return context.createError({ message: "Money amount must be in the format of <number> or <number>.<number>" });
    const whole = match[1];
    const decimals = match[3];
    if (decimals && decimals.length > currency.decimals) return context.createError({ message: `Too many decimals; ${currency.code} only has ${currency.decimals} decimals` });
    if (whole !== "0" && whole.startsWith("0")) return context.createError({ message: "Money amount must not have leading zeros" });
    return true;
  });
  var strictEmailSchema = (message) => yupString().email(message).max(256).matches(/^[^.]+(\.[^.]+)*@.*\.[^.][^.]+$/, message);
  var emailSchema = yupString().email();
  var clientOrHigherAuthTypeSchema = yupString().oneOf([
    "client",
    "server",
    "admin"
  ]).defined();
  var serverOrHigherAuthTypeSchema = yupString().oneOf(["server", "admin"]).defined();
  var adminAuthTypeSchema = yupString().oneOf(["admin"]).defined();
  var projectIdSchema = yupString().test((v) => v === void 0 || v === "internal" || isUuid(v)).meta({ openapiField: {
    description: _idDescription("project"),
    exampleValue: "e0b52f4d-dece-408c-af49-d23061bb0f8d"
  } });
  var projectBranchIdSchema = yupString().nonEmpty().max(255).meta({ openapiField: {
    description: _idDescription("project branch"),
    exampleValue: "main"
  } });
  var projectDisplayNameSchema = yupString().meta({ openapiField: {
    description: _displayNameDescription("project"),
    exampleValue: "MyMusic"
  } });
  var projectLogoUrlSchema = urlSchema.max(MAX_IMAGE_SIZE_BASE64_BYTES).meta({ openapiField: {
    description: "URL of the logo for the project. This is usually a close to 1:1 image of the company logo.",
    exampleValue: "https://example.com/logo.png"
  } });
  var projectLogoFullUrlSchema = urlSchema.max(MAX_IMAGE_SIZE_BASE64_BYTES).meta({ openapiField: {
    description: "URL of the full logo for the project. This is usually a vertical image with the logo and the company name.",
    exampleValue: "https://example.com/full-logo.png"
  } });
  var projectLogoDarkModeUrlSchema = urlSchema.max(MAX_IMAGE_SIZE_BASE64_BYTES).meta({ openapiField: {
    description: "URL of the dark mode logo for the project. This is usually a close to 1:1 image of the company logo optimized for dark backgrounds.",
    exampleValue: "https://example.com/logo-dark.png"
  } });
  var projectLogoFullDarkModeUrlSchema = urlSchema.max(MAX_IMAGE_SIZE_BASE64_BYTES).meta({ openapiField: {
    description: "URL of the dark mode full logo for the project. This is usually a vertical image with the logo and the company name optimized for dark backgrounds.",
    exampleValue: "https://example.com/full-logo-dark.png"
  } });
  var projectDescriptionSchema = yupString().nullable().meta({ openapiField: {
    description: "A human readable description of the project",
    exampleValue: "A music streaming service"
  } });
  var projectCreatedAtMillisSchema = yupNumber().meta({ openapiField: {
    description: _createdAtMillisDescription("project"),
    exampleValue: 163e10
  } });
  var projectIsProductionModeSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the project is in production mode",
    exampleValue: true
  } });
  var projectConfigIdSchema = yupString().meta({ openapiField: {
    description: _idDescription("project config"),
    exampleValue: "d09201f0-54f5-40bd-89ff-6d1815ddad24"
  } });
  var projectAllowLocalhostSchema = yupBoolean().meta({ openapiField: {
    description: "Whether localhost is allowed as a domain for this project. Should only be allowed in development mode",
    exampleValue: true
  } });
  var projectCreateTeamOnSignUpSchema = yupBoolean().meta({ openapiField: {
    description: "Whether a team should be created for each user that signs up",
    exampleValue: true
  } });
  var projectMagicLinkEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether magic link authentication is enabled for this project",
    exampleValue: true
  } });
  var projectPasskeyEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether passkey authentication is enabled for this project",
    exampleValue: true
  } });
  var projectClientTeamCreationEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether client users can create teams",
    exampleValue: true
  } });
  var projectClientUserDeletionEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether client users can delete their own account from the client",
    exampleValue: true
  } });
  var projectSignUpEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether users can sign up new accounts, or whether they are only allowed to sign in to existing accounts. Regardless of this option, the server API can always create new users with the `POST /users` endpoint.",
    exampleValue: true
  } });
  var projectCredentialEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether email password authentication is enabled for this project",
    exampleValue: true
  } });
  var oauthIdSchema = yupString().oneOf(allProviders).meta({ openapiField: {
    description: `OAuth provider ID, one of ${allProviders.map((x) => `\`${x}\``).join(", ")}`,
    exampleValue: "google"
  } });
  var oauthEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the OAuth provider is enabled. If an provider is first enabled, then disabled, it will be shown in the list but with enabled=false",
    exampleValue: true
  } });
  var oauthTypeSchema = yupString().oneOf(["shared", "standard"]).meta({ openapiField: {
    description: 'OAuth provider type, one of shared, standard. "shared" uses Stack shared OAuth keys and it is only meant for development. "standard" uses your own OAuth keys and will show your logo and company name when signing in with the provider.',
    exampleValue: "standard"
  } });
  var oauthClientIdSchema = yupString().meta({ openapiField: {
    description: 'OAuth client ID. Needs to be specified when using type="standard"',
    exampleValue: "google-oauth-client-id"
  } });
  var oauthClientSecretSchema = yupString().meta({ openapiField: {
    description: 'OAuth client secret. Needs to be specified when using type="standard"',
    exampleValue: "google-oauth-client-secret"
  } });
  var oauthFacebookConfigIdSchema = yupString().meta({ openapiField: { description: "The configuration id for Facebook business login (for things like ads and marketing). This is only required if you are using the standard OAuth with Facebook and you are using Facebook business login." } });
  var oauthMicrosoftTenantIdSchema = yupString().meta({ openapiField: { description: "The Microsoft tenant id for Microsoft directory. This is only required if you are using the standard OAuth with Microsoft and you have an Azure AD tenant." } });
  var oauthAppleBundleIdsSchema = yupArray(yupString().defined()).meta({ openapiField: {
    description: "Apple Bundle IDs for native iOS/macOS apps. Required for native Sign In with Apple (in addition to web Apple OAuth which uses the Client ID/Services ID).",
    exampleValue: ["com.example.ios", "com.example.macos"]
  } });
  var oauthAppleBundleIdSchema = yupString().defined().meta({ openapiField: {
    description: "Apple Bundle ID for native iOS/macOS apps.",
    exampleValue: "com.example.ios"
  } });
  var oauthAccountMergeStrategySchema = yupString().oneOf([
    "link_method",
    "raise_error",
    "allow_duplicates"
  ]).meta({ openapiField: {
    description: "Determines how to handle OAuth logins that match an existing user by email. `link_method` adds the OAuth method to the existing user. `raise_error` rejects the login with an error. `allow_duplicates` creates a new user.",
    exampleValue: "link_method"
  } });
  var emailTypeSchema = yupString().oneOf(["shared", "standard"]).meta({ openapiField: {
    description: 'Email provider type, one of shared, standard. "shared" uses Stack shared email provider and it is only meant for development. "standard" uses your own email server and will have your email address as the sender.',
    exampleValue: "standard"
  } });
  var emailSenderNameSchema = yupString().meta({ openapiField: {
    description: 'Email sender name. Needs to be specified when using type="standard"',
    exampleValue: "Stack"
  } });
  var emailHostSchema = yupString().meta({ openapiField: {
    description: 'Email host. Needs to be specified when using type="standard"',
    exampleValue: "smtp.your-domain.com"
  } });
  var emailPortSchema = yupNumber().min(0).max(65535).meta({ openapiField: {
    description: 'Email port. Needs to be specified when using type="standard"',
    exampleValue: 587
  } });
  var emailUsernameSchema = yupString().meta({ openapiField: {
    description: 'Email username. Needs to be specified when using type="standard"',
    exampleValue: "smtp-email"
  } });
  var emailSenderEmailSchema = emailSchema.meta({ openapiField: {
    description: 'Email sender email. Needs to be specified when using type="standard"',
    exampleValue: "example@your-domain.com"
  } });
  var emailPasswordSchema = passwordSchema.meta({ openapiField: {
    description: 'Email password. Needs to be specified when using type="standard"',
    exampleValue: "your-email-password"
  } });
  var handlerPathSchema = yupString().test("is-handler-path", "Handler path must start with /", (value) => value?.startsWith("/")).meta({ openapiField: {
    description: 'Handler path. If you did not setup a custom handler path, it should be "/handler" by default. It needs to start with /',
    exampleValue: "/handler"
  } });
  var emailThemeSchema = yupString().meta({ openapiField: { description: "Email theme id for the project. Determines the visual style of emails sent by the project." } });
  var emailThemeListSchema = yupRecord(yupString().uuid(), yupObject({
    displayName: yupString().meta({ openapiField: {
      description: "Email theme name",
      exampleValue: "Default Light"
    } }).defined(),
    tsxSource: yupString().meta({ openapiField: { description: "Email theme source code tsx component" } }).defined()
  })).meta({ openapiField: { description: "Record of email theme IDs to their display name and source code" } });
  var templateThemeIdSchema = yupMixed().test((v) => v === void 0 || v === false || v === null || typeof v === "string" && isUuid(v)).meta({ openapiField: { description: "Email theme id for the template" } }).optional();
  var emailTemplateListSchema = yupRecord(yupString().uuid(), yupObject({
    displayName: yupString().meta({ openapiField: {
      description: "Email template name",
      exampleValue: "Email Verification"
    } }).defined(),
    tsxSource: yupString().meta({ openapiField: { description: "Email template source code tsx component" } }).defined(),
    themeId: templateThemeIdSchema
  })).meta({ openapiField: { description: "Record of email template IDs to their display name and source code" } });
  var customDashboardsSchema = yupRecord(yupString().uuid(), yupObject({
    displayName: yupString().meta({ openapiField: {
      description: "Custom dashboard name",
      exampleValue: "User Growth Dashboard"
    } }).defined(),
    tsxSource: yupString().meta({ openapiField: { description: "Custom dashboard source code tsx component" } }).defined()
  })).meta({ openapiField: { description: "Record of custom dashboard IDs to their display name and source code" } });
  var customerTypeSchema = yupString().oneOf([
    "user",
    "team",
    "custom"
  ]);
  var validateHasAtLeastOneSupportedCurrency = (value, context) => {
    if (!value) return true;
    if (Object.keys(value).filter((key) => SUPPORTED_CURRENCIES.some((c3) => c3.code === key)).length === 0) return context.createError({ message: "At least one currency is required" });
    return true;
  };
  var productPriceSchema = yupObject({
    ...typedFromEntries(SUPPORTED_CURRENCIES.map((currency) => [currency.code, moneyAmountSchema(currency).optional()])),
    interval: dayIntervalSchema.optional(),
    serverOnly: yupBoolean(),
    freeTrial: dayIntervalSchema.optional()
  }).test("at-least-one-currency", (value, context) => validateHasAtLeastOneSupportedCurrency(value, context));
  var priceOrIncludeByDefaultSchema = yupUnion(yupString().oneOf(["include-by-default"]).meta({ openapiField: {
    description: "Makes this item free and includes it by default for all customers.",
    exampleValue: "include-by-default"
  } }), yupRecord(userSpecifiedIdSchema("priceId"), productPriceSchema));
  var productSchema = yupObject({
    displayName: yupString(),
    productLineId: userSpecifiedIdSchema("productLineId").optional().meta({ openapiField: {
      description: "The ID of the product line this product belongs to. Within a product line, all products are mutually exclusive unless they are an add-on to another product in the product line.",
      exampleValue: "product-line-id"
    } }),
    isAddOnTo: yupUnion(yupBoolean().isFalse(), yupRecord(userSpecifiedIdSchema("productId"), yupBoolean().isTrue().defined())).optional().meta({ openapiField: {
      description: "The products that this product is an add-on to. If this is set, the customer must already have one of the products in the record to be able to purchase this product.",
      exampleValue: { "product-id": true }
    } }),
    customerType: customerTypeSchema.defined(),
    freeTrial: dayIntervalSchema.optional(),
    serverOnly: yupBoolean(),
    stackable: yupBoolean(),
    prices: priceOrIncludeByDefaultSchema.defined(),
    includedItems: yupRecord(userSpecifiedIdSchema("itemId"), yupObject({
      quantity: yupNumber().defined(),
      repeat: dayIntervalOrNeverSchema.optional(),
      expires: yupString().oneOf([
        "never",
        "when-purchase-expires",
        "when-repeated"
      ]).optional()
    }))
  });
  var productMetadataExample = {
    featureFlag: true,
    source: "marketing-campaign"
  };
  var productClientMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _clientMetaDataDescription("product"),
    exampleValue: productMetadataExample
  } });
  var productClientReadOnlyMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _clientReadOnlyMetaDataDescription("product"),
    exampleValue: productMetadataExample
  } });
  var productServerMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _serverMetaDataDescription("product"),
    exampleValue: productMetadataExample
  } });
  var productSchemaWithMetadata = productSchema.concat(yupObject({
    clientMetadata: productClientMetadataSchema.optional(),
    clientReadOnlyMetadata: productClientReadOnlyMetadataSchema.optional(),
    serverMetadata: productServerMetadataSchema.optional()
  }));
  var inlineProductSchema = yupObject({
    display_name: yupString().defined(),
    customer_type: customerTypeSchema.defined(),
    free_trial: dayIntervalSchema.optional(),
    server_only: yupBoolean().default(true),
    stackable: yupBoolean().default(false),
    prices: yupRecord(userSpecifiedIdSchema("priceId"), yupObject({
      ...typedFromEntries(SUPPORTED_CURRENCIES.map((currency) => [currency.code, moneyAmountSchema(currency).optional()])),
      interval: dayIntervalSchema.optional(),
      free_trial: dayIntervalSchema.optional()
    }).test("at-least-one-currency", (value, context) => validateHasAtLeastOneSupportedCurrency(value, context))),
    included_items: yupRecord(userSpecifiedIdSchema("itemId"), yupObject({
      quantity: yupNumber(),
      repeat: dayIntervalOrNeverSchema.optional(),
      expires: yupString().oneOf([
        "never",
        "when-purchase-expires",
        "when-repeated"
      ]).optional()
    })),
    client_metadata: productClientMetadataSchema.optional(),
    client_read_only_metadata: productClientReadOnlyMetadataSchema.optional(),
    server_metadata: productServerMetadataSchema.optional()
  });
  var ReplaceFieldWithOwnUserId = class extends Error {
    constructor(path) {
      super(`This error should be caught by whoever validated the schema, and the field in the path '${path}' should be replaced with the current user's id. This is a workaround to yup not providing access to the context inside the transform function.`);
      this.path = path;
    }
  };
  var userIdMeSentinelUuid = "cad564fd-f81b-43f4-b390-98abf3fcc17e";
  var userIdOrMeSchema = yupString().uuid().transform((v) => {
    if (v === "me") return userIdMeSentinelUuid;
    else return v;
  }).test((v, context) => {
    if (!("stackAllowUserIdMe" in (context.options.context ?? {}))) throw new StackAssertionError("userIdOrMeSchema is not allowed in this context. Make sure you're using yupValidate from schema-fields.ts to validate, instead of schema.validate(...).");
    if (!context.options.context?.stackAllowUserIdMe) throw new StackAssertionError("userIdOrMeSchema is not allowed in this context. Make sure you're passing in the currentUserId option in yupValidate.");
    if (v === userIdMeSentinelUuid) throw new ReplaceFieldWithOwnUserId(context.path);
    return true;
  }).meta({ openapiField: {
    description: "The ID of the user, or the special value `me` for the currently authenticated user",
    exampleValue: "3241a285-8329-4d69-8f3d-316e08cf140c"
  } });
  var userIdSchema = yupString().uuid().meta({ openapiField: {
    description: _idDescription("user"),
    exampleValue: "3241a285-8329-4d69-8f3d-316e08cf140c"
  } });
  var primaryEmailSchema = emailSchema.meta({ openapiField: {
    description: "Primary email",
    exampleValue: "johndoe@example.com"
  } });
  var primaryEmailAuthEnabledSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the primary email is used for authentication. If this is set to `false`, the user will not be able to sign in with the primary email with password or OTP",
    exampleValue: true
  } });
  var primaryEmailVerifiedSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the primary email has been verified to belong to this user",
    exampleValue: true
  } });
  var userDisplayNameSchema = yupString().nullable().max(256).meta({ openapiField: {
    description: _displayNameDescription("user"),
    exampleValue: "John Doe"
  } });
  var selectedTeamIdSchema = yupString().uuid().meta({ openapiField: {
    description: "ID of the team currently selected by the user",
    exampleValue: "team-id"
  } });
  var profileImageUrlSchema = urlSchema.max(MAX_IMAGE_SIZE_BASE64_BYTES).meta({ openapiField: {
    description: _profileImageUrlDescription("user"),
    exampleValue: "https://example.com/image.jpg"
  } });
  var signedUpAtMillisSchema = yupNumber().meta({ openapiField: {
    description: _signedUpAtMillisDescription,
    exampleValue: 163e10
  } });
  var userClientMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _clientMetaDataDescription("user"),
    exampleValue: { key: "value" }
  } });
  var userClientReadOnlyMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _clientReadOnlyMetaDataDescription("user"),
    exampleValue: { key: "value" }
  } });
  var userServerMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _serverMetaDataDescription("user"),
    exampleValue: { key: "value" }
  } });
  var userOAuthProviderSchema = yupObject({
    id: yupString().defined(),
    type: yupString().oneOf(allProviders).defined(),
    provider_user_id: yupString().defined()
  });
  var userLastActiveAtMillisSchema = yupNumber().nullable().meta({ openapiField: {
    description: _lastActiveAtMillisDescription,
    exampleValue: 163e10
  } });
  var userPasskeyAuthEnabledSchema = yupBoolean().meta({ openapiField: {
    hidden: true,
    description: "Whether the user has passkeys enabled",
    exampleValue: false
  } });
  var userOtpAuthEnabledSchema = yupBoolean().meta({ openapiField: {
    hidden: true,
    description: "Whether the user has OTP/magic link enabled. ",
    exampleValue: true
  } });
  var userOtpAuthEnabledMutationSchema = yupBoolean().meta({ openapiField: {
    hidden: true,
    description: "Whether the user has OTP/magic link enabled. Note that only accounts with verified emails can sign-in with OTP.",
    exampleValue: true
  } });
  var userHasPasswordSchema = yupBoolean().meta({ openapiField: {
    hidden: true,
    description: "Whether the user has a password set. If the user does not have a password set, they will not be able to sign in with email/password.",
    exampleValue: true
  } });
  var userPasswordMutationSchema = passwordSchema.nullable().meta({ openapiField: {
    description: "Sets the user's password. Doing so revokes all current sessions.",
    exampleValue: "my-new-password"
  } }).max(70);
  var userPasswordHashMutationSchema = yupString().nonEmpty().meta({ openapiField: { description: "If `password` is not given, sets the user's password hash to the given string in Modular Crypt Format (ex.: `$2a$10$VIhIOofSMqGdGlL4wzE//e.77dAQGqNtF/1dT7bqCrVtQuInWy2qi`). Doing so revokes all current sessions." } });
  var userTotpSecretMutationSchema = base64Schema.nullable().meta({ openapiField: {
    description: "Enables 2FA and sets a TOTP secret for the user. Set to null to disable 2FA.",
    exampleValue: "dG90cC1zZWNyZXQ="
  } });
  var restrictedReasonTypes = [
    "anonymous",
    "email_not_verified",
    "restricted_by_administrator"
  ];
  var restrictedReasonSchema = yupObject({ type: yupString().oneOf(restrictedReasonTypes).defined() });
  var accessTokenPayloadSchema = yupObject({
    sub: yupString().defined(),
    exp: yupNumber().optional(),
    iat: yupNumber().defined(),
    iss: yupString().defined(),
    aud: yupString().defined(),
    project_id: yupString().defined(),
    branch_id: yupString().defined(),
    refresh_token_id: yupString().defined(),
    role: yupString().oneOf(["authenticated"]).defined(),
    name: yupString().defined().nullable(),
    email: yupString().defined().nullable(),
    email_verified: yupBoolean().defined(),
    selected_team_id: yupString().defined().nullable(),
    is_anonymous: yupBoolean().defined(),
    is_restricted: yupBoolean().defined(),
    restricted_reason: restrictedReasonSchema.defined().nullable(),
    requires_totp_mfa: yupBoolean().defined()
  });
  var signInEmailSchema = strictEmailSchema(void 0).meta({ openapiField: {
    description: "The email to sign in with.",
    exampleValue: "johndoe@example.com"
  } });
  var emailOtpSignInCallbackUrlSchema = urlSchema.meta({ openapiField: {
    description: "The base callback URL to construct the magic link from. A query parameter `code` with the verification code will be appended to it. The page should then make a request to the `/auth/otp/sign-in` endpoint.",
    exampleValue: "https://example.com/handler/magic-link-callback"
  } });
  var emailVerificationCallbackUrlSchema = urlSchema.meta({ openapiField: {
    description: "The base callback URL to construct a verification link for the verification e-mail. A query parameter `code` with the verification code will be appended to it. The page should then make a request to the `/contact-channels/verify` endpoint.",
    exampleValue: "https://example.com/handler/email-verification"
  } });
  var accessTokenResponseSchema = yupString().meta({ openapiField: {
    description: "Short-lived access token that can be used to authenticate the user",
    exampleValue: "eyJhmMiJB2TO...diI4QT"
  } });
  var refreshTokenResponseSchema = yupString().meta({ openapiField: {
    description: "Long-lived refresh token that can be used to obtain a new access token",
    exampleValue: "i8ns3aq2...14y"
  } });
  var signInResponseSchema = yupObject({
    refresh_token: refreshTokenResponseSchema.defined(),
    access_token: accessTokenResponseSchema.defined(),
    is_new_user: yupBoolean().meta({ openapiField: {
      description: "Whether the user is a new user",
      exampleValue: true
    } }).defined(),
    user_id: userIdSchema.defined()
  });
  var teamSystemPermissions = [
    "$update_team",
    "$delete_team",
    "$read_members",
    "$remove_members",
    "$invite_members",
    "$manage_api_keys"
  ];
  var permissionDefinitionIdSchema = yupString().matches(/^\$?[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":", "_" and optional "$" at the beginning are allowed').test("is-system-permission", "System permissions must start with a dollar sign", (value, ctx) => {
    if (!value) return true;
    if (value.startsWith("$") && !teamSystemPermissions.includes(value)) return ctx.createError({ message: "Invalid system permission" });
    return true;
  }).meta({ openapiField: {
    description: `The permission ID used to uniquely identify a permission. Can either be a custom permission with lowercase letters, numbers, \`:\`, and \`_\` characters, or one of the system permissions: ${teamSystemPermissions.map((x) => `\`${x}\``).join(", ")}`,
    exampleValue: "read_secret_info"
  } });
  var customPermissionDefinitionIdSchema = yupString().matches(/^[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":", "_" are allowed').meta({ openapiField: {
    description: 'The permission ID used to uniquely identify a permission. Can only contain lowercase letters, numbers, ":", and "_" characters',
    exampleValue: "read_secret_info"
  } });
  var teamPermissionDescriptionSchema = yupString().meta({ openapiField: {
    description: "A human-readable description of the permission",
    exampleValue: "Read secret information"
  } });
  var containedPermissionIdsSchema = yupArray(permissionDefinitionIdSchema.defined()).meta({ openapiField: {
    description: "The IDs of the permissions that are contained in this permission",
    exampleValue: ["read_public_info"]
  } });
  var teamIdSchema = yupString().uuid().meta({ openapiField: {
    description: _idDescription("team"),
    exampleValue: "ad962777-8244-496a-b6a2-e0c6a449c79e"
  } });
  var teamDisplayNameSchema = yupString().meta({ openapiField: {
    description: _displayNameDescription("team"),
    exampleValue: "My Team"
  } });
  var teamProfileImageUrlSchema = urlSchema.max(1e6).meta({ openapiField: {
    description: _profileImageUrlDescription("team"),
    exampleValue: "https://example.com/image.jpg"
  } });
  var teamClientMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _clientMetaDataDescription("team"),
    exampleValue: { key: "value" }
  } });
  var teamClientReadOnlyMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _clientReadOnlyMetaDataDescription("team"),
    exampleValue: { key: "value" }
  } });
  var teamServerMetadataSchema = jsonSchema.meta({ openapiField: {
    description: _serverMetaDataDescription("team"),
    exampleValue: { key: "value" }
  } });
  var teamCreatedAtMillisSchema = yupNumber().meta({ openapiField: {
    description: _createdAtMillisDescription("team"),
    exampleValue: 163e10
  } });
  var teamInvitationEmailSchema = emailSchema.meta({ openapiField: {
    description: "The email of the user to invite.",
    exampleValue: "johndoe@example.com"
  } });
  var teamInvitationCallbackUrlSchema = urlSchema.meta({ openapiField: {
    description: "The base callback URL to construct an invite link with. A query parameter `code` with the verification code will be appended to it. The page should then make a request to the `/team-invitations/accept` endpoint.",
    exampleValue: "https://example.com/handler/team-invitation"
  } });
  var teamCreatorUserIdSchema = userIdOrMeSchema.meta({ openapiField: {
    description: 'The ID of the creator of the team. If not specified, the user will not be added to the team. Can be either "me" or the ID of the user. Only used on the client side.',
    exampleValue: "me"
  } });
  var teamMemberDisplayNameSchema = yupString().meta({ openapiField: {
    description: _displayNameDescription("team member") + " Note that this is separate from the display_name of the user.",
    exampleValue: "John Doe"
  } });
  var teamMemberProfileImageUrlSchema = urlSchema.max(1e6).meta({ openapiField: {
    description: _profileImageUrlDescription("team member"),
    exampleValue: "https://example.com/image.jpg"
  } });
  var contactChannelIdSchema = yupString().uuid().meta({ openapiField: {
    description: _idDescription("contact channel"),
    exampleValue: "b3d396b8-c574-4c80-97b3-50031675ceb2"
  } });
  var contactChannelTypeSchema = yupString().oneOf(["email"]).meta({ openapiField: {
    description: `The type of the contact channel. Currently only "email" is supported.`,
    exampleValue: "email"
  } });
  var contactChannelValueSchema = yupString().when("type", {
    is: "email",
    then: (schema) => schema.email()
  }).meta({ openapiField: {
    description: "The value of the contact channel. For email, this should be a valid email address.",
    exampleValue: "johndoe@example.com"
  } });
  var contactChannelUsedForAuthSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the contact channel is used for authentication. If this is set to `true`, the user will be able to sign in with the contact channel with password or OTP.",
    exampleValue: true
  } });
  var contactChannelIsVerifiedSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the contact channel has been verified. If this is set to `true`, the contact channel has been verified to belong to the user.",
    exampleValue: true
  } });
  var contactChannelIsPrimarySchema = yupBoolean().meta({ openapiField: {
    description: "Whether the contact channel is the primary contact channel. If this is set to `true`, it will be used for authentication and notifications by default.",
    exampleValue: true
  } });
  var oauthProviderIdSchema = yupString().uuid().meta({ openapiField: {
    description: _idDescription("OAuth provider"),
    exampleValue: "b3d396b8-c574-4c80-97b3-50031675ceb2"
  } });
  var oauthProviderEmailSchema = emailSchema.meta({ openapiField: {
    description: "Email of the OAuth provider. This is used to display and identify the OAuth provider in the UI.",
    exampleValue: "test@gmail.com"
  } });
  var oauthProviderTypeSchema = yupString().oneOf(allProviders).meta({ openapiField: {
    description: `OAuth provider type, one of ${allProviders.map((x) => `\`${x}\``).join(", ")}`,
    exampleValue: "google"
  } });
  var oauthProviderAllowSignInSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the user can use this OAuth provider to sign in. Only one OAuth provider per type can have this set to `true`.",
    exampleValue: true
  } });
  var oauthProviderAllowConnectedAccountsSchema = yupBoolean().meta({ openapiField: {
    description: "Whether the user can use this OAuth provider as connected account. Multiple OAuth providers per type can have this set to `true`.",
    exampleValue: true
  } });
  var oauthProviderAccountIdSchema = yupString().meta({ openapiField: {
    description: "Account ID of the OAuth provider. This uniquely identifies the account on the provider side.",
    exampleValue: "google-account-id-12345"
  } });
  var oauthProviderProviderConfigIdSchema = yupString().meta({ openapiField: {
    description: "Provider config ID of the OAuth provider. This uniquely identifies the provider config on config.json file",
    exampleValue: "google"
  } });
  var basicAuthorizationHeaderSchema = yupString().test("is-basic-authorization-header", 'Authorization header must be in the format "Basic <base64>"', (value) => {
    if (!value) return true;
    return decodeBasicAuthorizationHeader(value) !== null;
  });
  var neonAuthorizationHeaderSchema = basicAuthorizationHeaderSchema.test("is-authorization-header", "Invalid client_id:client_secret values; did you use the correct values for the integration?", (value) => {
    if (!value) return true;
    const [clientId, clientSecret] = decodeBasicAuthorizationHeader(value) ?? throwErr(`Authz header invalid? This should've been validated by basicAuthorizationHeaderSchema: ${value}`);
    for (const neonClientConfig of JSON.parse(process.env.STACK_INTEGRATION_CLIENTS_CONFIG || "[]")) if (clientId === neonClientConfig.client_id && clientSecret === neonClientConfig.client_secret) return true;
    return false;
  });
  var branchConfigSourceSchema = yupUnion(yupObject({
    type: yupString().oneOf(["pushed-from-github"]).defined(),
    owner: yupString().defined(),
    repo: yupString().defined(),
    branch: yupString().defined(),
    commit_hash: yupString().defined(),
    config_file_path: yupString().defined()
  }), yupObject({ type: yupString().oneOf(["pushed-from-unknown"]).defined() }), yupObject({ type: yupString().oneOf(["unlinked"]).defined() }));

  // ../../node_modules/.pnpm/async-mutex@0.5.0/node_modules/async-mutex/index.mjs
  var E_TIMEOUT = new Error("timeout while waiting for mutex to become available");
  var E_ALREADY_LOCKED = new Error("mutex already locked");
  var E_CANCELED = new Error("request for lock canceled");
  var __awaiter$2 = function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e15) {
          reject(e15);
        }
      }
      function rejected2(value) {
        try {
          step(generator["throw"](value));
        } catch (e15) {
          reject(e15);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected2);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  var Semaphore = class {
    constructor(_value, _cancelError = E_CANCELED) {
      this._value = _value;
      this._cancelError = _cancelError;
      this._queue = [];
      this._weightedWaiters = [];
    }
    acquire(weight = 1, priority = 0) {
      if (weight <= 0)
        throw new Error(`invalid weight ${weight}: must be positive`);
      return new Promise((resolve, reject) => {
        const task = { resolve, reject, weight, priority };
        const i = findIndexFromEnd(this._queue, (other) => priority <= other.priority);
        if (i === -1 && weight <= this._value) {
          this._dispatchItem(task);
        } else {
          this._queue.splice(i + 1, 0, task);
        }
      });
    }
    runExclusive(callback_1) {
      return __awaiter$2(this, arguments, void 0, function* (callback, weight = 1, priority = 0) {
        const [value, release] = yield this.acquire(weight, priority);
        try {
          return yield callback(value);
        } finally {
          release();
        }
      });
    }
    waitForUnlock(weight = 1, priority = 0) {
      if (weight <= 0)
        throw new Error(`invalid weight ${weight}: must be positive`);
      if (this._couldLockImmediately(weight, priority)) {
        return Promise.resolve();
      } else {
        return new Promise((resolve) => {
          if (!this._weightedWaiters[weight - 1])
            this._weightedWaiters[weight - 1] = [];
          insertSorted(this._weightedWaiters[weight - 1], { resolve, priority });
        });
      }
    }
    isLocked() {
      return this._value <= 0;
    }
    getValue() {
      return this._value;
    }
    setValue(value) {
      this._value = value;
      this._dispatchQueue();
    }
    release(weight = 1) {
      if (weight <= 0)
        throw new Error(`invalid weight ${weight}: must be positive`);
      this._value += weight;
      this._dispatchQueue();
    }
    cancel() {
      this._queue.forEach((entry) => entry.reject(this._cancelError));
      this._queue = [];
    }
    _dispatchQueue() {
      this._drainUnlockWaiters();
      while (this._queue.length > 0 && this._queue[0].weight <= this._value) {
        this._dispatchItem(this._queue.shift());
        this._drainUnlockWaiters();
      }
    }
    _dispatchItem(item) {
      const previousValue = this._value;
      this._value -= item.weight;
      item.resolve([previousValue, this._newReleaser(item.weight)]);
    }
    _newReleaser(weight) {
      let called = false;
      return () => {
        if (called)
          return;
        called = true;
        this.release(weight);
      };
    }
    _drainUnlockWaiters() {
      if (this._queue.length === 0) {
        for (let weight = this._value; weight > 0; weight--) {
          const waiters = this._weightedWaiters[weight - 1];
          if (!waiters)
            continue;
          waiters.forEach((waiter) => waiter.resolve());
          this._weightedWaiters[weight - 1] = [];
        }
      } else {
        const queuedPriority = this._queue[0].priority;
        for (let weight = this._value; weight > 0; weight--) {
          const waiters = this._weightedWaiters[weight - 1];
          if (!waiters)
            continue;
          const i = waiters.findIndex((waiter) => waiter.priority <= queuedPriority);
          (i === -1 ? waiters : waiters.splice(0, i)).forEach((waiter) => waiter.resolve());
        }
      }
    }
    _couldLockImmediately(weight, priority) {
      return (this._queue.length === 0 || this._queue[0].priority < priority) && weight <= this._value;
    }
  };
  function insertSorted(a8, v) {
    const i = findIndexFromEnd(a8, (other) => v.priority <= other.priority);
    a8.splice(i + 1, 0, v);
  }
  function findIndexFromEnd(a8, predicate) {
    for (let i = a8.length - 1; i >= 0; i--) {
      if (predicate(a8[i])) {
        return i;
      }
    }
    return -1;
  }

  // ../stack-shared/dist/esm/utils/locks.js
  var ReadWriteLock = class {
    constructor() {
      this.semaphore = new Semaphore(1);
      this.readers = 0;
      this.readersMutex = new Semaphore(1);
    }
    async withReadLock(callback) {
      await this._acquireReadLock();
      try {
        return await callback();
      } finally {
        await this._releaseReadLock();
      }
    }
    async withWriteLock(callback) {
      await this._acquireWriteLock();
      try {
        return await callback();
      } finally {
        await this._releaseWriteLock();
      }
    }
    async _acquireReadLock() {
      await this.readersMutex.acquire();
      try {
        this.readers += 1;
        if (this.readers === 1) await this.semaphore.acquire();
      } finally {
        this.readersMutex.release();
      }
    }
    async _releaseReadLock() {
      await this.readersMutex.acquire();
      try {
        this.readers -= 1;
        if (this.readers === 0) this.semaphore.release();
      } finally {
        this.readersMutex.release();
      }
    }
    async _acquireWriteLock() {
      await this.semaphore.acquire();
    }
    async _releaseWriteLock() {
      this.semaphore.release();
    }
  };

  // ../stack-shared/dist/esm/utils/stores.js
  var storeLock = new ReadWriteLock();

  // ../stack-shared/dist/esm/interface/client-interface.js
  var USER_AGENT;
  if (typeof navigator === "undefined" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) USER_AGENT = `oauth4webapi/v3.8.3`;
  var ERR_INVALID_ARG_VALUE = "ERR_INVALID_ARG_VALUE";
  function CodedTypeError(message, code, cause) {
    const err = new TypeError(message, { cause });
    Object.assign(err, { code });
    return err;
  }
  var allowInsecureRequests = Symbol();
  var clockSkew = Symbol();
  var clockTolerance = Symbol();
  var customFetch = Symbol();
  var jweDecrypt = Symbol();
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var encodeBase64Url;
  if (Uint8Array.prototype.toBase64) encodeBase64Url = (input) => {
    if (input instanceof ArrayBuffer) input = new Uint8Array(input);
    return input.toBase64({
      alphabet: "base64url",
      omitPadding: true
    });
  };
  else {
    const CHUNK_SIZE = 32768;
    encodeBase64Url = (input) => {
      if (input instanceof ArrayBuffer) input = new Uint8Array(input);
      const arr = [];
      for (let i = 0; i < input.byteLength; i += CHUNK_SIZE) arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)));
      return btoa(arr.join("")).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    };
  }
  var decodeBase64Url;
  if (Uint8Array.fromBase64) decodeBase64Url = (input) => {
    try {
      return Uint8Array.fromBase64(input, { alphabet: "base64url" });
    } catch (cause) {
      throw CodedTypeError("The input to be decoded is not correctly encoded.", ERR_INVALID_ARG_VALUE, cause);
    }
  };
  else decodeBase64Url = (input) => {
    try {
      const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch (cause) {
      throw CodedTypeError("The input to be decoded is not correctly encoded.", ERR_INVALID_ARG_VALUE, cause);
    }
  };
  var URLParse = URL.parse ? (url, base) => URL.parse(url, base) : (url, base) => {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  };
  var tokenMatch = "[a-zA-Z0-9!#$%&\\'\\*\\+\\-\\.\\^_`\\|~]+";
  var token68Match = "[a-zA-Z0-9\\-\\._\\~\\+\\/]+={0,2}";
  var quotedParamMatcher = "(" + tokenMatch + ')\\s*=\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"';
  var paramMatcher = "(" + tokenMatch + ")\\s*=\\s*([a-zA-Z0-9!#$%&\\'\\*\\+\\-\\.\\^_`\\|~]+)";
  var schemeRE = new RegExp("^[,\\s]*(" + tokenMatch + ")");
  var quotedParamRE = new RegExp("^[,\\s]*" + quotedParamMatcher + "[,\\s]*(.*)");
  var unquotedParamRE = new RegExp("^[,\\s]*" + paramMatcher + "[,\\s]*(.*)");
  var token68ParamRE = new RegExp("^(" + token68Match + ")(?:$|[,\\s])(.*)");
  var nopkce = Symbol();
  var expectNoNonce = Symbol();
  var skipAuthTimeCheck = Symbol();
  var skipStateCheck = Symbol();
  var expectNoState = Symbol();
  var _expectedIssuer = Symbol();

  // ../stack-shared/dist/esm/utils/maps.js
  var _Symbol$toStringTag3;
  var _Symbol$toStringTag22;
  var _Symbol$toStringTag32;
  var WeakRefIfAvailable = class {
    constructor(value) {
      if (typeof WeakRef === "undefined") this._ref = { deref: () => value };
      else this._ref = new WeakRef(value);
    }
    deref() {
      return this._ref.deref();
    }
  };
  var _a2;
  var IterableWeakMap = (_a2 = class {
    constructor(entries) {
      this[_Symbol$toStringTag3] = "IterableWeakMap";
      const mappedEntries = entries?.map((e15) => [e15[0], {
        value: e15[1],
        keyRef: new WeakRefIfAvailable(e15[0])
      }]);
      this._weakMap = new WeakMap(mappedEntries ?? []);
      this._keyRefs = new Set(mappedEntries?.map((e15) => e15[1].keyRef) ?? []);
    }
    get(key) {
      return this._weakMap.get(key)?.value;
    }
    set(key, value) {
      const updated = {
        value,
        keyRef: this._weakMap.get(key)?.keyRef ?? new WeakRefIfAvailable(key)
      };
      this._weakMap.set(key, updated);
      this._keyRefs.add(updated.keyRef);
      return this;
    }
    delete(key) {
      const res = this._weakMap.get(key);
      if (res) {
        this._weakMap.delete(key);
        this._keyRefs.delete(res.keyRef);
        return true;
      }
      return false;
    }
    has(key) {
      return this._weakMap.has(key) && this._keyRefs.has(this._weakMap.get(key).keyRef);
    }
    *[Symbol.iterator]() {
      for (const keyRef of this._keyRefs) {
        const key = keyRef.deref();
        const existing = key ? this._weakMap.get(key) : void 0;
        if (!key) this._keyRefs.delete(keyRef);
        else if (existing) yield [key, existing.value];
      }
    }
  }, _Symbol$toStringTag3 = Symbol.toStringTag, _a2);
  var _a3;
  var MaybeWeakMap = (_a3 = class {
    constructor(entries) {
      this[_Symbol$toStringTag22] = "MaybeWeakMap";
      const entriesArray = [...entries ?? []];
      this._primitiveMap = new Map(entriesArray.filter((e15) => !this._isAllowedInWeakMap(e15[0])));
      this._weakMap = new IterableWeakMap(entriesArray.filter((e15) => this._isAllowedInWeakMap(e15[0])));
    }
    _isAllowedInWeakMap(key) {
      return typeof key === "object" && key !== null || typeof key === "symbol" && Symbol.keyFor(key) === void 0;
    }
    get(key) {
      if (this._isAllowedInWeakMap(key)) return this._weakMap.get(key);
      else return this._primitiveMap.get(key);
    }
    set(key, value) {
      if (this._isAllowedInWeakMap(key)) this._weakMap.set(key, value);
      else this._primitiveMap.set(key, value);
      return this;
    }
    delete(key) {
      if (this._isAllowedInWeakMap(key)) return this._weakMap.delete(key);
      else return this._primitiveMap.delete(key);
    }
    has(key) {
      if (this._isAllowedInWeakMap(key)) return this._weakMap.has(key);
      else return this._primitiveMap.has(key);
    }
    *[Symbol.iterator]() {
      yield* this._primitiveMap;
      yield* this._weakMap;
    }
  }, _Symbol$toStringTag22 = Symbol.toStringTag, _a3);
  var _a4;
  var DependenciesMap = (_a4 = class {
    constructor() {
      this._inner = {
        map: new MaybeWeakMap(),
        hasValue: false,
        value: void 0
      };
      this[_Symbol$toStringTag32] = "DependenciesMap";
    }
    _valueToResult(inner) {
      if (inner.hasValue) return Result.ok(inner.value);
      else return Result.error(void 0);
    }
    _unwrapFromInner(dependencies, inner) {
      if (dependencies.length === 0) return this._valueToResult(inner);
      else {
        const [key, ...rest] = dependencies;
        const newInner = inner.map.get(key);
        if (!newInner) return Result.error(void 0);
        return this._unwrapFromInner(rest, newInner);
      }
    }
    _setInInner(dependencies, value, inner) {
      if (dependencies.length === 0) {
        const res = this._valueToResult(inner);
        if (value.status === "ok") {
          inner.hasValue = true;
          inner.value = value.data;
        } else {
          inner.hasValue = false;
          inner.value = void 0;
        }
        return res;
      } else {
        const [key, ...rest] = dependencies;
        let newInner = inner.map.get(key);
        if (!newInner) inner.map.set(key, newInner = {
          map: new MaybeWeakMap(),
          hasValue: false,
          value: void 0
        });
        return this._setInInner(rest, value, newInner);
      }
    }
    *_iterateInner(dependencies, inner) {
      if (inner.hasValue) yield [dependencies, inner.value];
      for (const [key, value] of inner.map) yield* this._iterateInner([...dependencies, key], value);
    }
    get(dependencies) {
      return Result.or(this._unwrapFromInner(dependencies, this._inner), void 0);
    }
    set(dependencies, value) {
      this._setInInner(dependencies, Result.ok(value), this._inner);
      return this;
    }
    delete(dependencies) {
      return this._setInInner(dependencies, Result.error(void 0), this._inner).status === "ok";
    }
    has(dependencies) {
      return this._unwrapFromInner(dependencies, this._inner).status === "ok";
    }
    clear() {
      this._inner = {
        map: new MaybeWeakMap(),
        hasValue: false,
        value: void 0
      };
    }
    *[Symbol.iterator]() {
      yield* this._iterateInner([], this._inner);
    }
  }, _Symbol$toStringTag32 = Symbol.toStringTag, _a4);

  // ../stack-shared/dist/esm/utils/promises.js
  var neverResolvePromise = pending(new Promise(() => {
  }));
  function pending(promise, options = {}) {
    const res = promise.then((value) => {
      res.status = "fulfilled";
      res.value = value;
      return value;
    }, (actualReason) => {
      res.status = "rejected";
      res.reason = actualReason;
      throw actualReason;
    });
    res.status = "pending";
    return res;
  }
  function concatStacktracesIfRejected(promise) {
    const currentError = /* @__PURE__ */ new Error();
    promise.catch((error) => {
      if (error instanceof Error) concatStacktraces(error, currentError);
    });
  }
  async function wait(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new StackAssertionError(`wait() requires a non-negative integer number of milliseconds to wait. (found: ${ms}ms)`);
    if (ms >= 2 ** 31) throw new StackAssertionError("The maximum timeout for wait() is 2147483647ms (2**31 - 1). (found: ${ms}ms)");
    return await new Promise((resolve) => setTimeout(resolve, ms));
  }
  function runAsynchronouslyWithAlert(...args) {
    return runAsynchronously(args[0], {
      ...args[1],
      onError: (error) => {
        if (KnownError.isKnownError(error) && typeof process !== "undefined" && "production"?.includes("production")) alert(error.message);
        else alert(`An unhandled error occurred. Please ${false ? `check the browser console for the full error.` : "report this to the developer."}

${error}`);
        args[1]?.onError?.(error);
      }
    }, ...args.slice(2));
  }
  function runAsynchronously(promiseOrFunc, options = {}) {
    if (typeof promiseOrFunc === "function") promiseOrFunc = promiseOrFunc();
    if (promiseOrFunc) {
      concatStacktracesIfRejected(promiseOrFunc);
      promiseOrFunc.catch((error) => {
        options.onError?.(error);
        const newError = new StackAssertionError("Uncaught error in asynchronous function: " + errorToNiceString(error), { cause: error });
        if (!options.noErrorLogging) captureError("runAsynchronously", newError);
      });
    }
  }

  // ../stack-shared/dist/esm/utils/react.js
  function forwardRefIfNeeded(render) {
    const version = import_react3.default.version;
    if (parseInt(version.split(".")[0]) < 19) return import_react3.default.forwardRef(render);
    else return (props) => render(props, props.ref);
  }
  function useRefState(initialValue) {
    const lazyInitRef = import_react3.default.useRef(null);
    if (lazyInitRef.current === null) lazyInitRef.current = { v: typeof initialValue === "function" ? initialValue() : initialValue };
    const resolvedInitialValue = lazyInitRef.current.v;
    const [, setState] = import_react3.default.useState(() => resolvedInitialValue);
    const ref = import_react3.default.useRef(resolvedInitialValue);
    const setValue = import_react3.default.useCallback((updater) => {
      const value = typeof updater === "function" ? updater(ref.current) : updater;
      ref.current = value;
      setState(value);
    }, []);
    return import_react3.default.useMemo(() => ({
      get current() {
        return ref.current;
      },
      set: setValue
    }), [setValue]);
  }
  function mapRefState(refState, mapper, reverseMapper) {
    let last = null;
    return {
      get current() {
        const input = refState.current;
        if (last === null || input !== last[0]) last = [input, mapper(input)];
        return last[1];
      },
      set(updater) {
        const value = typeof updater === "function" ? updater(this.current) : updater;
        refState.set(reverseMapper(refState.current, value));
      }
    };
  }

  // ../../node_modules/.pnpm/@radix-ui+react-icons@1.3.1_react@19.2.1/node_modules/@radix-ui/react-icons/dist/react-icons.esm.js
  var import_react4 = __toESM(require_react());
  function _objectWithoutPropertiesLoose(source, excluded) {
    if (source == null) return {};
    var target = {};
    var sourceKeys = Object.keys(source);
    var key, i;
    for (i = 0; i < sourceKeys.length; i++) {
      key = sourceKeys[i];
      if (excluded.indexOf(key) >= 0) continue;
      target[key] = source[key];
    }
    return target;
  }
  var _excluded$1r = ["color"];
  var Cross2Icon = /* @__PURE__ */ (0, import_react4.forwardRef)(function(_ref2, forwardedRef) {
    var _ref$color = _ref2.color, color = _ref$color === void 0 ? "currentColor" : _ref$color, props = _objectWithoutPropertiesLoose(_ref2, _excluded$1r);
    return (0, import_react4.createElement)("svg", Object.assign({
      width: "15",
      height: "15",
      viewBox: "0 0 15 15",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg"
    }, props, {
      ref: forwardedRef
    }), (0, import_react4.createElement)("path", {
      d: "M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z",
      fill: color,
      fillRule: "evenodd",
      clipRule: "evenodd"
    }));
  });
  var _excluded$3E = ["color"];
  var ReloadIcon = /* @__PURE__ */ (0, import_react4.forwardRef)(function(_ref2, forwardedRef) {
    var _ref$color = _ref2.color, color = _ref$color === void 0 ? "currentColor" : _ref$color, props = _objectWithoutPropertiesLoose(_ref2, _excluded$3E);
    return (0, import_react4.createElement)("svg", Object.assign({
      width: "15",
      height: "15",
      viewBox: "0 0 15 15",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg"
    }, props, {
      ref: forwardedRef
    }), (0, import_react4.createElement)("path", {
      d: "M1.84998 7.49998C1.84998 4.66458 4.05979 1.84998 7.49998 1.84998C10.2783 1.84998 11.6515 3.9064 12.2367 5H10.5C10.2239 5 10 5.22386 10 5.5C10 5.77614 10.2239 6 10.5 6H13.5C13.7761 6 14 5.77614 14 5.5V2.5C14 2.22386 13.7761 2 13.5 2C13.2239 2 13 2.22386 13 2.5V4.31318C12.2955 3.07126 10.6659 0.849976 7.49998 0.849976C3.43716 0.849976 0.849976 4.18537 0.849976 7.49998C0.849976 10.8146 3.43716 14.15 7.49998 14.15C9.44382 14.15 11.0622 13.3808 12.2145 12.2084C12.8315 11.5806 13.3133 10.839 13.6418 10.0407C13.7469 9.78536 13.6251 9.49315 13.3698 9.38806C13.1144 9.28296 12.8222 9.40478 12.7171 9.66014C12.4363 10.3425 12.0251 10.9745 11.5013 11.5074C10.5295 12.4963 9.16504 13.15 7.49998 13.15C4.05979 13.15 1.84998 10.3354 1.84998 7.49998Z",
      fill: color,
      fillRule: "evenodd",
      clipRule: "evenodd"
    }));
  });

  // ../../node_modules/.pnpm/@radix-ui+react-slot@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-slot/dist/index.mjs
  var React4 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-compose-refs@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-compose-refs/dist/index.mjs
  var React3 = __toESM(require_react(), 1);
  function setRef(ref, value) {
    if (typeof ref === "function") {
      ref(value);
    } else if (ref !== null && ref !== void 0) {
      ref.current = value;
    }
  }
  function composeRefs(...refs) {
    return (node) => refs.forEach((ref) => setRef(ref, node));
  }
  function useComposedRefs(...refs) {
    return React3.useCallback(composeRefs(...refs), refs);
  }

  // ../../node_modules/.pnpm/@radix-ui+react-slot@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-slot/dist/index.mjs
  var Slot = React4.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    const childrenArray = React4.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable);
    if (slottable) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) => {
        if (child === slottable) {
          if (React4.Children.count(newElement) > 1) return React4.Children.only(null);
          return React4.isValidElement(newElement) ? newElement.props.children : null;
        } else {
          return child;
        }
      });
      return /* @__PURE__ */ jsx(SlotClone, { ...slotProps, ref: forwardedRef, children: React4.isValidElement(newElement) ? React4.cloneElement(newElement, void 0, newChildren) : null });
    }
    return /* @__PURE__ */ jsx(SlotClone, { ...slotProps, ref: forwardedRef, children });
  });
  Slot.displayName = "Slot";
  var SlotClone = React4.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    if (React4.isValidElement(children)) {
      const childrenRef = getElementRef(children);
      return React4.cloneElement(children, {
        ...mergeProps(slotProps, children.props),
        // @ts-ignore
        ref: forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef
      });
    }
    return React4.Children.count(children) > 1 ? React4.Children.only(null) : null;
  });
  SlotClone.displayName = "SlotClone";
  var Slottable = ({ children }) => {
    return /* @__PURE__ */ jsx(Fragment8, { children });
  };
  function isSlottable(child) {
    return React4.isValidElement(child) && child.type === Slottable;
  }
  function mergeProps(slotProps, childProps) {
    const overrideProps = { ...childProps };
    for (const propName in childProps) {
      const slotPropValue = slotProps[propName];
      const childPropValue = childProps[propName];
      const isHandler = /^on[A-Z]/.test(propName);
      if (isHandler) {
        if (slotPropValue && childPropValue) {
          overrideProps[propName] = (...args) => {
            childPropValue(...args);
            slotPropValue(...args);
          };
        } else if (slotPropValue) {
          overrideProps[propName] = slotPropValue;
        }
      } else if (propName === "style") {
        overrideProps[propName] = { ...slotPropValue, ...childPropValue };
      } else if (propName === "className") {
        overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
      }
    }
    return { ...slotProps, ...overrideProps };
  }
  function getElementRef(element) {
    let getter2 = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
    let mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.ref;
    }
    getter2 = Object.getOwnPropertyDescriptor(element, "ref")?.get;
    mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.props.ref;
    }
    return element.props.ref || element.ref;
  }

  // ../stack-shared/dist/esm/hooks/use-async-callback.js
  var import_react5 = __toESM(require_react());
  function useAsyncCallback(callback, deps) {
    const [error, setError] = import_react5.default.useState(void 0);
    const [loadingCount, setLoadingCount] = import_react5.default.useState(0);
    return [
      import_react5.default.useCallback(async (...args) => {
        setLoadingCount((c3) => c3 + 1);
        try {
          return await callback(...args);
        } catch (e15) {
          setError(e15);
          throw e15;
        } finally {
          setLoadingCount((c3) => c3 - 1);
        }
      }, deps),
      loadingCount > 0,
      error
    ];
  }

  // ../stack-ui/dist/esm/components/ui/spinner.js
  var import_react6 = __toESM(require_react());
  var Spinner = forwardRefIfNeeded(({ size: size5 = 15, ...props }, ref) => {
    return /* @__PURE__ */ jsx("span", {
      ref,
      ...props,
      className: cn("stack-scope", props.className),
      children: /* @__PURE__ */ jsx(ReloadIcon, {
        className: "animate-spin",
        width: size5,
        height: size5
      })
    });
  });
  Spinner.displayName = "Spinner";

  // ../../node_modules/.pnpm/@radix-ui+primitive@1.1.0/node_modules/@radix-ui/primitive/dist/index.mjs
  function composeEventHandlers(originalEventHandler, ourEventHandler, { checkForDefaultPrevented = true } = {}) {
    return function handleEvent(event) {
      originalEventHandler?.(event);
      if (checkForDefaultPrevented === false || !event.defaultPrevented) {
        return ourEventHandler?.(event);
      }
    };
  }

  // ../../node_modules/.pnpm/@radix-ui+react-context@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-context/dist/index.mjs
  var React7 = __toESM(require_react(), 1);
  function createContextScope(scopeName, createContextScopeDeps = []) {
    let defaultContexts = [];
    function createContext32(rootComponentName, defaultContext) {
      const BaseContext = React7.createContext(defaultContext);
      const index3 = defaultContexts.length;
      defaultContexts = [...defaultContexts, defaultContext];
      function Provider2(props) {
        const { scope, children, ...context } = props;
        const Context = scope?.[scopeName][index3] || BaseContext;
        const value = React7.useMemo(() => context, Object.values(context));
        return /* @__PURE__ */ jsx(Context.Provider, { value, children });
      }
      function useContext22(consumerName, scope) {
        const Context = scope?.[scopeName][index3] || BaseContext;
        const context = React7.useContext(Context);
        if (context) return context;
        if (defaultContext !== void 0) return defaultContext;
        throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
      }
      Provider2.displayName = rootComponentName + "Provider";
      return [Provider2, useContext22];
    }
    const createScope = () => {
      const scopeContexts = defaultContexts.map((defaultContext) => {
        return React7.createContext(defaultContext);
      });
      return function useScope(scope) {
        const contexts = scope?.[scopeName] || scopeContexts;
        return React7.useMemo(
          () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
          [scope, contexts]
        );
      };
    };
    createScope.scopeName = scopeName;
    return [createContext32, composeContextScopes(createScope, ...createContextScopeDeps)];
  }
  function composeContextScopes(...scopes) {
    const baseScope = scopes[0];
    if (scopes.length === 1) return baseScope;
    const createScope = () => {
      const scopeHooks = scopes.map((createScope2) => ({
        useScope: createScope2(),
        scopeName: createScope2.scopeName
      }));
      return function useComposedScopes(overrideScopes) {
        const nextScopes = scopeHooks.reduce((nextScopes2, { useScope, scopeName }) => {
          const scopeProps = useScope(overrideScopes);
          const currentScope = scopeProps[`__scope${scopeName}`];
          return { ...nextScopes2, ...currentScope };
        }, {});
        return React7.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
      };
    };
    createScope.scopeName = baseScope.scopeName;
    return createScope;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-context@1.1.1_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-context/dist/index.mjs
  var React8 = __toESM(require_react(), 1);
  function createContext22(rootComponentName, defaultContext) {
    const Context = React8.createContext(defaultContext);
    const Provider2 = (props) => {
      const { children, ...context } = props;
      const value = React8.useMemo(() => context, Object.values(context));
      return /* @__PURE__ */ jsx(Context.Provider, { value, children });
    };
    Provider2.displayName = rootComponentName + "Provider";
    function useContext22(consumerName) {
      const context = React8.useContext(Context);
      if (context) return context;
      if (defaultContext !== void 0) return defaultContext;
      throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
    }
    return [Provider2, useContext22];
  }
  function createContextScope2(scopeName, createContextScopeDeps = []) {
    let defaultContexts = [];
    function createContext32(rootComponentName, defaultContext) {
      const BaseContext = React8.createContext(defaultContext);
      const index3 = defaultContexts.length;
      defaultContexts = [...defaultContexts, defaultContext];
      const Provider2 = (props) => {
        const { scope, children, ...context } = props;
        const Context = scope?.[scopeName]?.[index3] || BaseContext;
        const value = React8.useMemo(() => context, Object.values(context));
        return /* @__PURE__ */ jsx(Context.Provider, { value, children });
      };
      Provider2.displayName = rootComponentName + "Provider";
      function useContext22(consumerName, scope) {
        const Context = scope?.[scopeName]?.[index3] || BaseContext;
        const context = React8.useContext(Context);
        if (context) return context;
        if (defaultContext !== void 0) return defaultContext;
        throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
      }
      return [Provider2, useContext22];
    }
    const createScope = () => {
      const scopeContexts = defaultContexts.map((defaultContext) => {
        return React8.createContext(defaultContext);
      });
      return function useScope(scope) {
        const contexts = scope?.[scopeName] || scopeContexts;
        return React8.useMemo(
          () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
          [scope, contexts]
        );
      };
    };
    createScope.scopeName = scopeName;
    return [createContext32, composeContextScopes2(createScope, ...createContextScopeDeps)];
  }
  function composeContextScopes2(...scopes) {
    const baseScope = scopes[0];
    if (scopes.length === 1) return baseScope;
    const createScope = () => {
      const scopeHooks = scopes.map((createScope2) => ({
        useScope: createScope2(),
        scopeName: createScope2.scopeName
      }));
      return function useComposedScopes(overrideScopes) {
        const nextScopes = scopeHooks.reduce((nextScopes2, { useScope, scopeName }) => {
          const scopeProps = useScope(overrideScopes);
          const currentScope = scopeProps[`__scope${scopeName}`];
          return { ...nextScopes2, ...currentScope };
        }, {});
        return React8.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
      };
    };
    createScope.scopeName = baseScope.scopeName;
    return createScope;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-dismissable-layer@1.1.1_@types+react-dom@18.3.1_@types+react@18.3.12_re_f005e7f95aa2eec7605cf7f5e28f987f/node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
  var React12 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-primitive@2.0.0_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-primitive/dist/index.mjs
  var React9 = __toESM(require_react(), 1);
  var ReactDOM = __toESM(require_react_dom(), 1);
  var NODES = [
    "a",
    "button",
    "div",
    "form",
    "h2",
    "h3",
    "img",
    "input",
    "label",
    "li",
    "nav",
    "ol",
    "p",
    "span",
    "svg",
    "ul"
  ];
  var Primitive = NODES.reduce((primitive, node) => {
    const Node2 = React9.forwardRef((props, forwardedRef) => {
      const { asChild, ...primitiveProps } = props;
      const Comp = asChild ? Slot : node;
      if (typeof window !== "undefined") {
        window[Symbol.for("radix-ui")] = true;
      }
      return /* @__PURE__ */ jsx(Comp, { ...primitiveProps, ref: forwardedRef });
    });
    Node2.displayName = `Primitive.${node}`;
    return { ...primitive, [node]: Node2 };
  }, {});
  function dispatchDiscreteCustomEvent(target, event) {
    if (target) ReactDOM.flushSync(() => target.dispatchEvent(event));
  }

  // ../../node_modules/.pnpm/@radix-ui+react-use-callback-ref@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
  var React10 = __toESM(require_react(), 1);
  function useCallbackRef(callback) {
    const callbackRef = React10.useRef(callback);
    React10.useEffect(() => {
      callbackRef.current = callback;
    });
    return React10.useMemo(() => (...args) => callbackRef.current?.(...args), []);
  }

  // ../../node_modules/.pnpm/@radix-ui+react-use-escape-keydown@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-use-escape-keydown/dist/index.mjs
  var React11 = __toESM(require_react(), 1);
  function useEscapeKeydown(onEscapeKeyDownProp, ownerDocument = globalThis?.document) {
    const onEscapeKeyDown = useCallbackRef(onEscapeKeyDownProp);
    React11.useEffect(() => {
      const handleKeyDown = (event) => {
        if (event.key === "Escape") {
          onEscapeKeyDown(event);
        }
      };
      ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => ownerDocument.removeEventListener("keydown", handleKeyDown, { capture: true });
    }, [onEscapeKeyDown, ownerDocument]);
  }

  // ../../node_modules/.pnpm/@radix-ui+react-dismissable-layer@1.1.1_@types+react-dom@18.3.1_@types+react@18.3.12_re_f005e7f95aa2eec7605cf7f5e28f987f/node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
  var DISMISSABLE_LAYER_NAME = "DismissableLayer";
  var CONTEXT_UPDATE = "dismissableLayer.update";
  var POINTER_DOWN_OUTSIDE = "dismissableLayer.pointerDownOutside";
  var FOCUS_OUTSIDE = "dismissableLayer.focusOutside";
  var originalBodyPointerEvents;
  var DismissableLayerContext = React12.createContext({
    layers: /* @__PURE__ */ new Set(),
    layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
    branches: /* @__PURE__ */ new Set()
  });
  var DismissableLayer = React12.forwardRef(
    (props, forwardedRef) => {
      const {
        disableOutsidePointerEvents = false,
        onEscapeKeyDown,
        onPointerDownOutside,
        onFocusOutside,
        onInteractOutside,
        onDismiss,
        ...layerProps
      } = props;
      const context = React12.useContext(DismissableLayerContext);
      const [node, setNode] = React12.useState(null);
      const ownerDocument = node?.ownerDocument ?? globalThis?.document;
      const [, force] = React12.useState({});
      const composedRefs = useComposedRefs(forwardedRef, (node2) => setNode(node2));
      const layers = Array.from(context.layers);
      const [highestLayerWithOutsidePointerEventsDisabled] = [...context.layersWithOutsidePointerEventsDisabled].slice(-1);
      const highestLayerWithOutsidePointerEventsDisabledIndex = layers.indexOf(highestLayerWithOutsidePointerEventsDisabled);
      const index3 = node ? layers.indexOf(node) : -1;
      const isBodyPointerEventsDisabled = context.layersWithOutsidePointerEventsDisabled.size > 0;
      const isPointerEventsEnabled = index3 >= highestLayerWithOutsidePointerEventsDisabledIndex;
      const pointerDownOutside = usePointerDownOutside((event) => {
        const target = event.target;
        const isPointerDownOnBranch = [...context.branches].some((branch) => branch.contains(target));
        if (!isPointerEventsEnabled || isPointerDownOnBranch) return;
        onPointerDownOutside?.(event);
        onInteractOutside?.(event);
        if (!event.defaultPrevented) onDismiss?.();
      }, ownerDocument);
      const focusOutside = useFocusOutside((event) => {
        const target = event.target;
        const isFocusInBranch = [...context.branches].some((branch) => branch.contains(target));
        if (isFocusInBranch) return;
        onFocusOutside?.(event);
        onInteractOutside?.(event);
        if (!event.defaultPrevented) onDismiss?.();
      }, ownerDocument);
      useEscapeKeydown((event) => {
        const isHighestLayer = index3 === context.layers.size - 1;
        if (!isHighestLayer) return;
        onEscapeKeyDown?.(event);
        if (!event.defaultPrevented && onDismiss) {
          event.preventDefault();
          onDismiss();
        }
      }, ownerDocument);
      React12.useEffect(() => {
        if (!node) return;
        if (disableOutsidePointerEvents) {
          if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
            originalBodyPointerEvents = ownerDocument.body.style.pointerEvents;
            ownerDocument.body.style.pointerEvents = "none";
          }
          context.layersWithOutsidePointerEventsDisabled.add(node);
        }
        context.layers.add(node);
        dispatchUpdate();
        return () => {
          if (disableOutsidePointerEvents && context.layersWithOutsidePointerEventsDisabled.size === 1) {
            ownerDocument.body.style.pointerEvents = originalBodyPointerEvents;
          }
        };
      }, [node, ownerDocument, disableOutsidePointerEvents, context]);
      React12.useEffect(() => {
        return () => {
          if (!node) return;
          context.layers.delete(node);
          context.layersWithOutsidePointerEventsDisabled.delete(node);
          dispatchUpdate();
        };
      }, [node, context]);
      React12.useEffect(() => {
        const handleUpdate = () => force({});
        document.addEventListener(CONTEXT_UPDATE, handleUpdate);
        return () => document.removeEventListener(CONTEXT_UPDATE, handleUpdate);
      }, []);
      return /* @__PURE__ */ jsx(
        Primitive.div,
        {
          ...layerProps,
          ref: composedRefs,
          style: {
            pointerEvents: isBodyPointerEventsDisabled ? isPointerEventsEnabled ? "auto" : "none" : void 0,
            ...props.style
          },
          onFocusCapture: composeEventHandlers(props.onFocusCapture, focusOutside.onFocusCapture),
          onBlurCapture: composeEventHandlers(props.onBlurCapture, focusOutside.onBlurCapture),
          onPointerDownCapture: composeEventHandlers(
            props.onPointerDownCapture,
            pointerDownOutside.onPointerDownCapture
          )
        }
      );
    }
  );
  DismissableLayer.displayName = DISMISSABLE_LAYER_NAME;
  var BRANCH_NAME = "DismissableLayerBranch";
  var DismissableLayerBranch = React12.forwardRef((props, forwardedRef) => {
    const context = React12.useContext(DismissableLayerContext);
    const ref = React12.useRef(null);
    const composedRefs = useComposedRefs(forwardedRef, ref);
    React12.useEffect(() => {
      const node = ref.current;
      if (node) {
        context.branches.add(node);
        return () => {
          context.branches.delete(node);
        };
      }
    }, [context.branches]);
    return /* @__PURE__ */ jsx(Primitive.div, { ...props, ref: composedRefs });
  });
  DismissableLayerBranch.displayName = BRANCH_NAME;
  function usePointerDownOutside(onPointerDownOutside, ownerDocument = globalThis?.document) {
    const handlePointerDownOutside = useCallbackRef(onPointerDownOutside);
    const isPointerInsideReactTreeRef = React12.useRef(false);
    const handleClickRef = React12.useRef(() => {
    });
    React12.useEffect(() => {
      const handlePointerDown = (event) => {
        if (event.target && !isPointerInsideReactTreeRef.current) {
          let handleAndDispatchPointerDownOutsideEvent2 = function() {
            handleAndDispatchCustomEvent(
              POINTER_DOWN_OUTSIDE,
              handlePointerDownOutside,
              eventDetail,
              { discrete: true }
            );
          };
          var handleAndDispatchPointerDownOutsideEvent = handleAndDispatchPointerDownOutsideEvent2;
          const eventDetail = { originalEvent: event };
          if (event.pointerType === "touch") {
            ownerDocument.removeEventListener("click", handleClickRef.current);
            handleClickRef.current = handleAndDispatchPointerDownOutsideEvent2;
            ownerDocument.addEventListener("click", handleClickRef.current, { once: true });
          } else {
            handleAndDispatchPointerDownOutsideEvent2();
          }
        } else {
          ownerDocument.removeEventListener("click", handleClickRef.current);
        }
        isPointerInsideReactTreeRef.current = false;
      };
      const timerId = window.setTimeout(() => {
        ownerDocument.addEventListener("pointerdown", handlePointerDown);
      }, 0);
      return () => {
        window.clearTimeout(timerId);
        ownerDocument.removeEventListener("pointerdown", handlePointerDown);
        ownerDocument.removeEventListener("click", handleClickRef.current);
      };
    }, [ownerDocument, handlePointerDownOutside]);
    return {
      // ensures we check React component tree (not just DOM tree)
      onPointerDownCapture: () => isPointerInsideReactTreeRef.current = true
    };
  }
  function useFocusOutside(onFocusOutside, ownerDocument = globalThis?.document) {
    const handleFocusOutside = useCallbackRef(onFocusOutside);
    const isFocusInsideReactTreeRef = React12.useRef(false);
    React12.useEffect(() => {
      const handleFocus = (event) => {
        if (event.target && !isFocusInsideReactTreeRef.current) {
          const eventDetail = { originalEvent: event };
          handleAndDispatchCustomEvent(FOCUS_OUTSIDE, handleFocusOutside, eventDetail, {
            discrete: false
          });
        }
      };
      ownerDocument.addEventListener("focusin", handleFocus);
      return () => ownerDocument.removeEventListener("focusin", handleFocus);
    }, [ownerDocument, handleFocusOutside]);
    return {
      onFocusCapture: () => isFocusInsideReactTreeRef.current = true,
      onBlurCapture: () => isFocusInsideReactTreeRef.current = false
    };
  }
  function dispatchUpdate() {
    const event = new CustomEvent(CONTEXT_UPDATE);
    document.dispatchEvent(event);
  }
  function handleAndDispatchCustomEvent(name, handler, detail, { discrete }) {
    const target = detail.originalEvent.target;
    const event = new CustomEvent(name, { bubbles: false, cancelable: true, detail });
    if (handler) target.addEventListener(name, handler, { once: true });
    if (discrete) {
      dispatchDiscreteCustomEvent(target, event);
    } else {
      target.dispatchEvent(event);
    }
  }

  // ../../node_modules/.pnpm/@radix-ui+react-focus-guards@1.1.1_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-focus-guards/dist/index.mjs
  var React13 = __toESM(require_react(), 1);
  var count = 0;
  function useFocusGuards() {
    React13.useEffect(() => {
      const edgeGuards = document.querySelectorAll("[data-radix-focus-guard]");
      document.body.insertAdjacentElement("afterbegin", edgeGuards[0] ?? createFocusGuard());
      document.body.insertAdjacentElement("beforeend", edgeGuards[1] ?? createFocusGuard());
      count++;
      return () => {
        if (count === 1) {
          document.querySelectorAll("[data-radix-focus-guard]").forEach((node) => node.remove());
        }
        count--;
      };
    }, []);
  }
  function createFocusGuard() {
    const element = document.createElement("span");
    element.setAttribute("data-radix-focus-guard", "");
    element.tabIndex = 0;
    element.style.outline = "none";
    element.style.opacity = "0";
    element.style.position = "fixed";
    element.style.pointerEvents = "none";
    return element;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-focus-scope@1.1.0_@types+react-dom@18.3.1_@types+react@18.3.12_react-do_f9f134574f0ee5ed4c833d1baa7ea781/node_modules/@radix-ui/react-focus-scope/dist/index.mjs
  var React14 = __toESM(require_react(), 1);
  var AUTOFOCUS_ON_MOUNT = "focusScope.autoFocusOnMount";
  var AUTOFOCUS_ON_UNMOUNT = "focusScope.autoFocusOnUnmount";
  var EVENT_OPTIONS = { bubbles: false, cancelable: true };
  var FOCUS_SCOPE_NAME = "FocusScope";
  var FocusScope = React14.forwardRef((props, forwardedRef) => {
    const {
      loop = false,
      trapped = false,
      onMountAutoFocus: onMountAutoFocusProp,
      onUnmountAutoFocus: onUnmountAutoFocusProp,
      ...scopeProps
    } = props;
    const [container, setContainer] = React14.useState(null);
    const onMountAutoFocus = useCallbackRef(onMountAutoFocusProp);
    const onUnmountAutoFocus = useCallbackRef(onUnmountAutoFocusProp);
    const lastFocusedElementRef = React14.useRef(null);
    const composedRefs = useComposedRefs(forwardedRef, (node) => setContainer(node));
    const focusScope = React14.useRef({
      paused: false,
      pause() {
        this.paused = true;
      },
      resume() {
        this.paused = false;
      }
    }).current;
    React14.useEffect(() => {
      if (trapped) {
        let handleFocusIn2 = function(event) {
          if (focusScope.paused || !container) return;
          const target = event.target;
          if (container.contains(target)) {
            lastFocusedElementRef.current = target;
          } else {
            focus(lastFocusedElementRef.current, { select: true });
          }
        }, handleFocusOut2 = function(event) {
          if (focusScope.paused || !container) return;
          const relatedTarget = event.relatedTarget;
          if (relatedTarget === null) return;
          if (!container.contains(relatedTarget)) {
            focus(lastFocusedElementRef.current, { select: true });
          }
        }, handleMutations2 = function(mutations) {
          const focusedElement = document.activeElement;
          if (focusedElement !== document.body) return;
          for (const mutation of mutations) {
            if (mutation.removedNodes.length > 0) focus(container);
          }
        };
        var handleFocusIn = handleFocusIn2, handleFocusOut = handleFocusOut2, handleMutations = handleMutations2;
        document.addEventListener("focusin", handleFocusIn2);
        document.addEventListener("focusout", handleFocusOut2);
        const mutationObserver = new MutationObserver(handleMutations2);
        if (container) mutationObserver.observe(container, { childList: true, subtree: true });
        return () => {
          document.removeEventListener("focusin", handleFocusIn2);
          document.removeEventListener("focusout", handleFocusOut2);
          mutationObserver.disconnect();
        };
      }
    }, [trapped, container, focusScope.paused]);
    React14.useEffect(() => {
      if (container) {
        focusScopesStack.add(focusScope);
        const previouslyFocusedElement = document.activeElement;
        const hasFocusedCandidate = container.contains(previouslyFocusedElement);
        if (!hasFocusedCandidate) {
          const mountEvent = new CustomEvent(AUTOFOCUS_ON_MOUNT, EVENT_OPTIONS);
          container.addEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus);
          container.dispatchEvent(mountEvent);
          if (!mountEvent.defaultPrevented) {
            focusFirst(removeLinks(getTabbableCandidates(container)), { select: true });
            if (document.activeElement === previouslyFocusedElement) {
              focus(container);
            }
          }
        }
        return () => {
          container.removeEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus);
          setTimeout(() => {
            const unmountEvent = new CustomEvent(AUTOFOCUS_ON_UNMOUNT, EVENT_OPTIONS);
            container.addEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus);
            container.dispatchEvent(unmountEvent);
            if (!unmountEvent.defaultPrevented) {
              focus(previouslyFocusedElement ?? document.body, { select: true });
            }
            container.removeEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus);
            focusScopesStack.remove(focusScope);
          }, 0);
        };
      }
    }, [container, onMountAutoFocus, onUnmountAutoFocus, focusScope]);
    const handleKeyDown = React14.useCallback(
      (event) => {
        if (!loop && !trapped) return;
        if (focusScope.paused) return;
        const isTabKey = event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
        const focusedElement = document.activeElement;
        if (isTabKey && focusedElement) {
          const container2 = event.currentTarget;
          const [first, last] = getTabbableEdges(container2);
          const hasTabbableElementsInside = first && last;
          if (!hasTabbableElementsInside) {
            if (focusedElement === container2) event.preventDefault();
          } else {
            if (!event.shiftKey && focusedElement === last) {
              event.preventDefault();
              if (loop) focus(first, { select: true });
            } else if (event.shiftKey && focusedElement === first) {
              event.preventDefault();
              if (loop) focus(last, { select: true });
            }
          }
        }
      },
      [loop, trapped, focusScope.paused]
    );
    return /* @__PURE__ */ jsx(Primitive.div, { tabIndex: -1, ...scopeProps, ref: composedRefs, onKeyDown: handleKeyDown });
  });
  FocusScope.displayName = FOCUS_SCOPE_NAME;
  function focusFirst(candidates, { select = false } = {}) {
    const previouslyFocusedElement = document.activeElement;
    for (const candidate of candidates) {
      focus(candidate, { select });
      if (document.activeElement !== previouslyFocusedElement) return;
    }
  }
  function getTabbableEdges(container) {
    const candidates = getTabbableCandidates(container);
    const first = findVisible(candidates, container);
    const last = findVisible(candidates.reverse(), container);
    return [first, last];
  }
  function getTabbableCandidates(container) {
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        const isHiddenInput = node.tagName === "INPUT" && node.type === "hidden";
        if (node.disabled || node.hidden || isHiddenInput) return NodeFilter.FILTER_SKIP;
        return node.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  function findVisible(elements, container) {
    for (const element of elements) {
      if (!isHidden(element, { upTo: container })) return element;
    }
  }
  function isHidden(node, { upTo }) {
    if (getComputedStyle(node).visibility === "hidden") return true;
    while (node) {
      if (upTo !== void 0 && node === upTo) return false;
      if (getComputedStyle(node).display === "none") return true;
      node = node.parentElement;
    }
    return false;
  }
  function isSelectableInput(element) {
    return element instanceof HTMLInputElement && "select" in element;
  }
  function focus(element, { select = false } = {}) {
    if (element && element.focus) {
      const previouslyFocusedElement = document.activeElement;
      element.focus({ preventScroll: true });
      if (element !== previouslyFocusedElement && isSelectableInput(element) && select)
        element.select();
    }
  }
  var focusScopesStack = createFocusScopesStack();
  function createFocusScopesStack() {
    let stack = [];
    return {
      add(focusScope) {
        const activeFocusScope = stack[0];
        if (focusScope !== activeFocusScope) {
          activeFocusScope?.pause();
        }
        stack = arrayRemove(stack, focusScope);
        stack.unshift(focusScope);
      },
      remove(focusScope) {
        stack = arrayRemove(stack, focusScope);
        stack[0]?.resume();
      }
    };
  }
  function arrayRemove(array2, item) {
    const updatedArray = [...array2];
    const index3 = updatedArray.indexOf(item);
    if (index3 !== -1) {
      updatedArray.splice(index3, 1);
    }
    return updatedArray;
  }
  function removeLinks(items) {
    return items.filter((item) => item.tagName !== "A");
  }

  // ../../node_modules/.pnpm/@radix-ui+react-id@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-id/dist/index.mjs
  var React16 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-use-layout-effect@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
  var React15 = __toESM(require_react(), 1);
  var useLayoutEffect2 = Boolean(globalThis?.document) ? React15.useLayoutEffect : () => {
  };

  // ../../node_modules/.pnpm/@radix-ui+react-id@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-id/dist/index.mjs
  var useReactId = React16["useId".toString()] || (() => void 0);
  var count2 = 0;
  function useId(deterministicId) {
    const [id, setId] = React16.useState(useReactId());
    useLayoutEffect2(() => {
      if (!deterministicId) setId((reactId) => reactId ?? String(count2++));
    }, [deterministicId]);
    return deterministicId || (id ? `radix-${id}` : "");
  }

  // ../../node_modules/.pnpm/@radix-ui+react-popper@1.2.0_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-popper/dist/index.mjs
  var React20 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@floating-ui+utils@0.2.8/node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
  var sides = ["top", "right", "bottom", "left"];
  var min = Math.min;
  var max = Math.max;
  var round = Math.round;
  var floor = Math.floor;
  var createCoords = (v) => ({
    x: v,
    y: v
  });
  var oppositeSideMap = {
    left: "right",
    right: "left",
    bottom: "top",
    top: "bottom"
  };
  var oppositeAlignmentMap = {
    start: "end",
    end: "start"
  };
  function clamp(start, value, end) {
    return max(start, min(value, end));
  }
  function evaluate(value, param) {
    return typeof value === "function" ? value(param) : value;
  }
  function getSide(placement) {
    return placement.split("-")[0];
  }
  function getAlignment(placement) {
    return placement.split("-")[1];
  }
  function getOppositeAxis(axis) {
    return axis === "x" ? "y" : "x";
  }
  function getAxisLength(axis) {
    return axis === "y" ? "height" : "width";
  }
  function getSideAxis(placement) {
    return ["top", "bottom"].includes(getSide(placement)) ? "y" : "x";
  }
  function getAlignmentAxis(placement) {
    return getOppositeAxis(getSideAxis(placement));
  }
  function getAlignmentSides(placement, rects, rtl) {
    if (rtl === void 0) {
      rtl = false;
    }
    const alignment = getAlignment(placement);
    const alignmentAxis = getAlignmentAxis(placement);
    const length = getAxisLength(alignmentAxis);
    let mainAlignmentSide = alignmentAxis === "x" ? alignment === (rtl ? "end" : "start") ? "right" : "left" : alignment === "start" ? "bottom" : "top";
    if (rects.reference[length] > rects.floating[length]) {
      mainAlignmentSide = getOppositePlacement(mainAlignmentSide);
    }
    return [mainAlignmentSide, getOppositePlacement(mainAlignmentSide)];
  }
  function getExpandedPlacements(placement) {
    const oppositePlacement = getOppositePlacement(placement);
    return [getOppositeAlignmentPlacement(placement), oppositePlacement, getOppositeAlignmentPlacement(oppositePlacement)];
  }
  function getOppositeAlignmentPlacement(placement) {
    return placement.replace(/start|end/g, (alignment) => oppositeAlignmentMap[alignment]);
  }
  function getSideList(side, isStart, rtl) {
    const lr = ["left", "right"];
    const rl = ["right", "left"];
    const tb = ["top", "bottom"];
    const bt = ["bottom", "top"];
    switch (side) {
      case "top":
      case "bottom":
        if (rtl) return isStart ? rl : lr;
        return isStart ? lr : rl;
      case "left":
      case "right":
        return isStart ? tb : bt;
      default:
        return [];
    }
  }
  function getOppositeAxisPlacements(placement, flipAlignment, direction, rtl) {
    const alignment = getAlignment(placement);
    let list = getSideList(getSide(placement), direction === "start", rtl);
    if (alignment) {
      list = list.map((side) => side + "-" + alignment);
      if (flipAlignment) {
        list = list.concat(list.map(getOppositeAlignmentPlacement));
      }
    }
    return list;
  }
  function getOppositePlacement(placement) {
    return placement.replace(/left|right|bottom|top/g, (side) => oppositeSideMap[side]);
  }
  function expandPaddingObject(padding) {
    return {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      ...padding
    };
  }
  function getPaddingObject(padding) {
    return typeof padding !== "number" ? expandPaddingObject(padding) : {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding
    };
  }
  function rectToClientRect(rect) {
    const {
      x,
      y,
      width,
      height
    } = rect;
    return {
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      x,
      y
    };
  }

  // ../../node_modules/.pnpm/@floating-ui+core@1.6.8/node_modules/@floating-ui/core/dist/floating-ui.core.mjs
  function computeCoordsFromPlacement(_ref2, placement, rtl) {
    let {
      reference,
      floating
    } = _ref2;
    const sideAxis = getSideAxis(placement);
    const alignmentAxis = getAlignmentAxis(placement);
    const alignLength = getAxisLength(alignmentAxis);
    const side = getSide(placement);
    const isVertical = sideAxis === "y";
    const commonX = reference.x + reference.width / 2 - floating.width / 2;
    const commonY = reference.y + reference.height / 2 - floating.height / 2;
    const commonAlign = reference[alignLength] / 2 - floating[alignLength] / 2;
    let coords;
    switch (side) {
      case "top":
        coords = {
          x: commonX,
          y: reference.y - floating.height
        };
        break;
      case "bottom":
        coords = {
          x: commonX,
          y: reference.y + reference.height
        };
        break;
      case "right":
        coords = {
          x: reference.x + reference.width,
          y: commonY
        };
        break;
      case "left":
        coords = {
          x: reference.x - floating.width,
          y: commonY
        };
        break;
      default:
        coords = {
          x: reference.x,
          y: reference.y
        };
    }
    switch (getAlignment(placement)) {
      case "start":
        coords[alignmentAxis] -= commonAlign * (rtl && isVertical ? -1 : 1);
        break;
      case "end":
        coords[alignmentAxis] += commonAlign * (rtl && isVertical ? -1 : 1);
        break;
    }
    return coords;
  }
  var computePosition = async (reference, floating, config) => {
    const {
      placement = "bottom",
      strategy = "absolute",
      middleware = [],
      platform: platform2
    } = config;
    const validMiddleware = middleware.filter(Boolean);
    const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(floating));
    let rects = await platform2.getElementRects({
      reference,
      floating,
      strategy
    });
    let {
      x,
      y
    } = computeCoordsFromPlacement(rects, placement, rtl);
    let statefulPlacement = placement;
    let middlewareData = {};
    let resetCount = 0;
    for (let i = 0; i < validMiddleware.length; i++) {
      const {
        name,
        fn
      } = validMiddleware[i];
      const {
        x: nextX,
        y: nextY,
        data,
        reset
      } = await fn({
        x,
        y,
        initialPlacement: placement,
        placement: statefulPlacement,
        strategy,
        middlewareData,
        rects,
        platform: platform2,
        elements: {
          reference,
          floating
        }
      });
      x = nextX != null ? nextX : x;
      y = nextY != null ? nextY : y;
      middlewareData = {
        ...middlewareData,
        [name]: {
          ...middlewareData[name],
          ...data
        }
      };
      if (reset && resetCount <= 50) {
        resetCount++;
        if (typeof reset === "object") {
          if (reset.placement) {
            statefulPlacement = reset.placement;
          }
          if (reset.rects) {
            rects = reset.rects === true ? await platform2.getElementRects({
              reference,
              floating,
              strategy
            }) : reset.rects;
          }
          ({
            x,
            y
          } = computeCoordsFromPlacement(rects, statefulPlacement, rtl));
        }
        i = -1;
      }
    }
    return {
      x,
      y,
      placement: statefulPlacement,
      strategy,
      middlewareData
    };
  };
  async function detectOverflow(state, options) {
    var _await$platform$isEle;
    if (options === void 0) {
      options = {};
    }
    const {
      x,
      y,
      platform: platform2,
      rects,
      elements,
      strategy
    } = state;
    const {
      boundary = "clippingAncestors",
      rootBoundary = "viewport",
      elementContext = "floating",
      altBoundary = false,
      padding = 0
    } = evaluate(options, state);
    const paddingObject = getPaddingObject(padding);
    const altContext = elementContext === "floating" ? "reference" : "floating";
    const element = elements[altBoundary ? altContext : elementContext];
    const clippingClientRect = rectToClientRect(await platform2.getClippingRect({
      element: ((_await$platform$isEle = await (platform2.isElement == null ? void 0 : platform2.isElement(element))) != null ? _await$platform$isEle : true) ? element : element.contextElement || await (platform2.getDocumentElement == null ? void 0 : platform2.getDocumentElement(elements.floating)),
      boundary,
      rootBoundary,
      strategy
    }));
    const rect = elementContext === "floating" ? {
      x,
      y,
      width: rects.floating.width,
      height: rects.floating.height
    } : rects.reference;
    const offsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(elements.floating));
    const offsetScale = await (platform2.isElement == null ? void 0 : platform2.isElement(offsetParent)) ? await (platform2.getScale == null ? void 0 : platform2.getScale(offsetParent)) || {
      x: 1,
      y: 1
    } : {
      x: 1,
      y: 1
    };
    const elementClientRect = rectToClientRect(platform2.convertOffsetParentRelativeRectToViewportRelativeRect ? await platform2.convertOffsetParentRelativeRectToViewportRelativeRect({
      elements,
      rect,
      offsetParent,
      strategy
    }) : rect);
    return {
      top: (clippingClientRect.top - elementClientRect.top + paddingObject.top) / offsetScale.y,
      bottom: (elementClientRect.bottom - clippingClientRect.bottom + paddingObject.bottom) / offsetScale.y,
      left: (clippingClientRect.left - elementClientRect.left + paddingObject.left) / offsetScale.x,
      right: (elementClientRect.right - clippingClientRect.right + paddingObject.right) / offsetScale.x
    };
  }
  var arrow = (options) => ({
    name: "arrow",
    options,
    async fn(state) {
      const {
        x,
        y,
        placement,
        rects,
        platform: platform2,
        elements,
        middlewareData
      } = state;
      const {
        element,
        padding = 0
      } = evaluate(options, state) || {};
      if (element == null) {
        return {};
      }
      const paddingObject = getPaddingObject(padding);
      const coords = {
        x,
        y
      };
      const axis = getAlignmentAxis(placement);
      const length = getAxisLength(axis);
      const arrowDimensions = await platform2.getDimensions(element);
      const isYAxis = axis === "y";
      const minProp = isYAxis ? "top" : "left";
      const maxProp = isYAxis ? "bottom" : "right";
      const clientProp = isYAxis ? "clientHeight" : "clientWidth";
      const endDiff = rects.reference[length] + rects.reference[axis] - coords[axis] - rects.floating[length];
      const startDiff = coords[axis] - rects.reference[axis];
      const arrowOffsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(element));
      let clientSize = arrowOffsetParent ? arrowOffsetParent[clientProp] : 0;
      if (!clientSize || !await (platform2.isElement == null ? void 0 : platform2.isElement(arrowOffsetParent))) {
        clientSize = elements.floating[clientProp] || rects.floating[length];
      }
      const centerToReference = endDiff / 2 - startDiff / 2;
      const largestPossiblePadding = clientSize / 2 - arrowDimensions[length] / 2 - 1;
      const minPadding = min(paddingObject[minProp], largestPossiblePadding);
      const maxPadding = min(paddingObject[maxProp], largestPossiblePadding);
      const min$1 = minPadding;
      const max2 = clientSize - arrowDimensions[length] - maxPadding;
      const center = clientSize / 2 - arrowDimensions[length] / 2 + centerToReference;
      const offset5 = clamp(min$1, center, max2);
      const shouldAddOffset = !middlewareData.arrow && getAlignment(placement) != null && center !== offset5 && rects.reference[length] / 2 - (center < min$1 ? minPadding : maxPadding) - arrowDimensions[length] / 2 < 0;
      const alignmentOffset = shouldAddOffset ? center < min$1 ? center - min$1 : center - max2 : 0;
      return {
        [axis]: coords[axis] + alignmentOffset,
        data: {
          [axis]: offset5,
          centerOffset: center - offset5 - alignmentOffset,
          ...shouldAddOffset && {
            alignmentOffset
          }
        },
        reset: shouldAddOffset
      };
    }
  });
  var flip = function(options) {
    if (options === void 0) {
      options = {};
    }
    return {
      name: "flip",
      options,
      async fn(state) {
        var _middlewareData$arrow, _middlewareData$flip;
        const {
          placement,
          middlewareData,
          rects,
          initialPlacement,
          platform: platform2,
          elements
        } = state;
        const {
          mainAxis: checkMainAxis = true,
          crossAxis: checkCrossAxis = true,
          fallbackPlacements: specifiedFallbackPlacements,
          fallbackStrategy = "bestFit",
          fallbackAxisSideDirection = "none",
          flipAlignment = true,
          ...detectOverflowOptions
        } = evaluate(options, state);
        if ((_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
          return {};
        }
        const side = getSide(placement);
        const initialSideAxis = getSideAxis(initialPlacement);
        const isBasePlacement = getSide(initialPlacement) === initialPlacement;
        const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
        const fallbackPlacements = specifiedFallbackPlacements || (isBasePlacement || !flipAlignment ? [getOppositePlacement(initialPlacement)] : getExpandedPlacements(initialPlacement));
        const hasFallbackAxisSideDirection = fallbackAxisSideDirection !== "none";
        if (!specifiedFallbackPlacements && hasFallbackAxisSideDirection) {
          fallbackPlacements.push(...getOppositeAxisPlacements(initialPlacement, flipAlignment, fallbackAxisSideDirection, rtl));
        }
        const placements2 = [initialPlacement, ...fallbackPlacements];
        const overflow = await detectOverflow(state, detectOverflowOptions);
        const overflows = [];
        let overflowsData = ((_middlewareData$flip = middlewareData.flip) == null ? void 0 : _middlewareData$flip.overflows) || [];
        if (checkMainAxis) {
          overflows.push(overflow[side]);
        }
        if (checkCrossAxis) {
          const sides2 = getAlignmentSides(placement, rects, rtl);
          overflows.push(overflow[sides2[0]], overflow[sides2[1]]);
        }
        overflowsData = [...overflowsData, {
          placement,
          overflows
        }];
        if (!overflows.every((side2) => side2 <= 0)) {
          var _middlewareData$flip2, _overflowsData$filter;
          const nextIndex = (((_middlewareData$flip2 = middlewareData.flip) == null ? void 0 : _middlewareData$flip2.index) || 0) + 1;
          const nextPlacement = placements2[nextIndex];
          if (nextPlacement) {
            return {
              data: {
                index: nextIndex,
                overflows: overflowsData
              },
              reset: {
                placement: nextPlacement
              }
            };
          }
          let resetPlacement = (_overflowsData$filter = overflowsData.filter((d) => d.overflows[0] <= 0).sort((a8, b) => a8.overflows[1] - b.overflows[1])[0]) == null ? void 0 : _overflowsData$filter.placement;
          if (!resetPlacement) {
            switch (fallbackStrategy) {
              case "bestFit": {
                var _overflowsData$filter2;
                const placement2 = (_overflowsData$filter2 = overflowsData.filter((d) => {
                  if (hasFallbackAxisSideDirection) {
                    const currentSideAxis = getSideAxis(d.placement);
                    return currentSideAxis === initialSideAxis || // Create a bias to the `y` side axis due to horizontal
                    // reading directions favoring greater width.
                    currentSideAxis === "y";
                  }
                  return true;
                }).map((d) => [d.placement, d.overflows.filter((overflow2) => overflow2 > 0).reduce((acc, overflow2) => acc + overflow2, 0)]).sort((a8, b) => a8[1] - b[1])[0]) == null ? void 0 : _overflowsData$filter2[0];
                if (placement2) {
                  resetPlacement = placement2;
                }
                break;
              }
              case "initialPlacement":
                resetPlacement = initialPlacement;
                break;
            }
          }
          if (placement !== resetPlacement) {
            return {
              reset: {
                placement: resetPlacement
              }
            };
          }
        }
        return {};
      }
    };
  };
  function getSideOffsets(overflow, rect) {
    return {
      top: overflow.top - rect.height,
      right: overflow.right - rect.width,
      bottom: overflow.bottom - rect.height,
      left: overflow.left - rect.width
    };
  }
  function isAnySideFullyClipped(overflow) {
    return sides.some((side) => overflow[side] >= 0);
  }
  var hide = function(options) {
    if (options === void 0) {
      options = {};
    }
    return {
      name: "hide",
      options,
      async fn(state) {
        const {
          rects
        } = state;
        const {
          strategy = "referenceHidden",
          ...detectOverflowOptions
        } = evaluate(options, state);
        switch (strategy) {
          case "referenceHidden": {
            const overflow = await detectOverflow(state, {
              ...detectOverflowOptions,
              elementContext: "reference"
            });
            const offsets = getSideOffsets(overflow, rects.reference);
            return {
              data: {
                referenceHiddenOffsets: offsets,
                referenceHidden: isAnySideFullyClipped(offsets)
              }
            };
          }
          case "escaped": {
            const overflow = await detectOverflow(state, {
              ...detectOverflowOptions,
              altBoundary: true
            });
            const offsets = getSideOffsets(overflow, rects.floating);
            return {
              data: {
                escapedOffsets: offsets,
                escaped: isAnySideFullyClipped(offsets)
              }
            };
          }
          default: {
            return {};
          }
        }
      }
    };
  };
  async function convertValueToCoords(state, options) {
    const {
      placement,
      platform: platform2,
      elements
    } = state;
    const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
    const side = getSide(placement);
    const alignment = getAlignment(placement);
    const isVertical = getSideAxis(placement) === "y";
    const mainAxisMulti = ["left", "top"].includes(side) ? -1 : 1;
    const crossAxisMulti = rtl && isVertical ? -1 : 1;
    const rawValue = evaluate(options, state);
    let {
      mainAxis,
      crossAxis,
      alignmentAxis
    } = typeof rawValue === "number" ? {
      mainAxis: rawValue,
      crossAxis: 0,
      alignmentAxis: null
    } : {
      mainAxis: rawValue.mainAxis || 0,
      crossAxis: rawValue.crossAxis || 0,
      alignmentAxis: rawValue.alignmentAxis
    };
    if (alignment && typeof alignmentAxis === "number") {
      crossAxis = alignment === "end" ? alignmentAxis * -1 : alignmentAxis;
    }
    return isVertical ? {
      x: crossAxis * crossAxisMulti,
      y: mainAxis * mainAxisMulti
    } : {
      x: mainAxis * mainAxisMulti,
      y: crossAxis * crossAxisMulti
    };
  }
  var offset = function(options) {
    if (options === void 0) {
      options = 0;
    }
    return {
      name: "offset",
      options,
      async fn(state) {
        var _middlewareData$offse, _middlewareData$arrow;
        const {
          x,
          y,
          placement,
          middlewareData
        } = state;
        const diffCoords = await convertValueToCoords(state, options);
        if (placement === ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse.placement) && (_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
          return {};
        }
        return {
          x: x + diffCoords.x,
          y: y + diffCoords.y,
          data: {
            ...diffCoords,
            placement
          }
        };
      }
    };
  };
  var shift = function(options) {
    if (options === void 0) {
      options = {};
    }
    return {
      name: "shift",
      options,
      async fn(state) {
        const {
          x,
          y,
          placement
        } = state;
        const {
          mainAxis: checkMainAxis = true,
          crossAxis: checkCrossAxis = false,
          limiter = {
            fn: (_ref2) => {
              let {
                x: x2,
                y: y2
              } = _ref2;
              return {
                x: x2,
                y: y2
              };
            }
          },
          ...detectOverflowOptions
        } = evaluate(options, state);
        const coords = {
          x,
          y
        };
        const overflow = await detectOverflow(state, detectOverflowOptions);
        const crossAxis = getSideAxis(getSide(placement));
        const mainAxis = getOppositeAxis(crossAxis);
        let mainAxisCoord = coords[mainAxis];
        let crossAxisCoord = coords[crossAxis];
        if (checkMainAxis) {
          const minSide = mainAxis === "y" ? "top" : "left";
          const maxSide = mainAxis === "y" ? "bottom" : "right";
          const min2 = mainAxisCoord + overflow[minSide];
          const max2 = mainAxisCoord - overflow[maxSide];
          mainAxisCoord = clamp(min2, mainAxisCoord, max2);
        }
        if (checkCrossAxis) {
          const minSide = crossAxis === "y" ? "top" : "left";
          const maxSide = crossAxis === "y" ? "bottom" : "right";
          const min2 = crossAxisCoord + overflow[minSide];
          const max2 = crossAxisCoord - overflow[maxSide];
          crossAxisCoord = clamp(min2, crossAxisCoord, max2);
        }
        const limitedCoords = limiter.fn({
          ...state,
          [mainAxis]: mainAxisCoord,
          [crossAxis]: crossAxisCoord
        });
        return {
          ...limitedCoords,
          data: {
            x: limitedCoords.x - x,
            y: limitedCoords.y - y,
            enabled: {
              [mainAxis]: checkMainAxis,
              [crossAxis]: checkCrossAxis
            }
          }
        };
      }
    };
  };
  var limitShift = function(options) {
    if (options === void 0) {
      options = {};
    }
    return {
      options,
      fn(state) {
        const {
          x,
          y,
          placement,
          rects,
          middlewareData
        } = state;
        const {
          offset: offset5 = 0,
          mainAxis: checkMainAxis = true,
          crossAxis: checkCrossAxis = true
        } = evaluate(options, state);
        const coords = {
          x,
          y
        };
        const crossAxis = getSideAxis(placement);
        const mainAxis = getOppositeAxis(crossAxis);
        let mainAxisCoord = coords[mainAxis];
        let crossAxisCoord = coords[crossAxis];
        const rawOffset = evaluate(offset5, state);
        const computedOffset = typeof rawOffset === "number" ? {
          mainAxis: rawOffset,
          crossAxis: 0
        } : {
          mainAxis: 0,
          crossAxis: 0,
          ...rawOffset
        };
        if (checkMainAxis) {
          const len = mainAxis === "y" ? "height" : "width";
          const limitMin = rects.reference[mainAxis] - rects.floating[len] + computedOffset.mainAxis;
          const limitMax = rects.reference[mainAxis] + rects.reference[len] - computedOffset.mainAxis;
          if (mainAxisCoord < limitMin) {
            mainAxisCoord = limitMin;
          } else if (mainAxisCoord > limitMax) {
            mainAxisCoord = limitMax;
          }
        }
        if (checkCrossAxis) {
          var _middlewareData$offse, _middlewareData$offse2;
          const len = mainAxis === "y" ? "width" : "height";
          const isOriginSide = ["top", "left"].includes(getSide(placement));
          const limitMin = rects.reference[crossAxis] - rects.floating[len] + (isOriginSide ? ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse[crossAxis]) || 0 : 0) + (isOriginSide ? 0 : computedOffset.crossAxis);
          const limitMax = rects.reference[crossAxis] + rects.reference[len] + (isOriginSide ? 0 : ((_middlewareData$offse2 = middlewareData.offset) == null ? void 0 : _middlewareData$offse2[crossAxis]) || 0) - (isOriginSide ? computedOffset.crossAxis : 0);
          if (crossAxisCoord < limitMin) {
            crossAxisCoord = limitMin;
          } else if (crossAxisCoord > limitMax) {
            crossAxisCoord = limitMax;
          }
        }
        return {
          [mainAxis]: mainAxisCoord,
          [crossAxis]: crossAxisCoord
        };
      }
    };
  };
  var size = function(options) {
    if (options === void 0) {
      options = {};
    }
    return {
      name: "size",
      options,
      async fn(state) {
        var _state$middlewareData, _state$middlewareData2;
        const {
          placement,
          rects,
          platform: platform2,
          elements
        } = state;
        const {
          apply = () => {
          },
          ...detectOverflowOptions
        } = evaluate(options, state);
        const overflow = await detectOverflow(state, detectOverflowOptions);
        const side = getSide(placement);
        const alignment = getAlignment(placement);
        const isYAxis = getSideAxis(placement) === "y";
        const {
          width,
          height
        } = rects.floating;
        let heightSide;
        let widthSide;
        if (side === "top" || side === "bottom") {
          heightSide = side;
          widthSide = alignment === (await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating)) ? "start" : "end") ? "left" : "right";
        } else {
          widthSide = side;
          heightSide = alignment === "end" ? "top" : "bottom";
        }
        const maximumClippingHeight = height - overflow.top - overflow.bottom;
        const maximumClippingWidth = width - overflow.left - overflow.right;
        const overflowAvailableHeight = min(height - overflow[heightSide], maximumClippingHeight);
        const overflowAvailableWidth = min(width - overflow[widthSide], maximumClippingWidth);
        const noShift = !state.middlewareData.shift;
        let availableHeight = overflowAvailableHeight;
        let availableWidth = overflowAvailableWidth;
        if ((_state$middlewareData = state.middlewareData.shift) != null && _state$middlewareData.enabled.x) {
          availableWidth = maximumClippingWidth;
        }
        if ((_state$middlewareData2 = state.middlewareData.shift) != null && _state$middlewareData2.enabled.y) {
          availableHeight = maximumClippingHeight;
        }
        if (noShift && !alignment) {
          const xMin = max(overflow.left, 0);
          const xMax = max(overflow.right, 0);
          const yMin = max(overflow.top, 0);
          const yMax = max(overflow.bottom, 0);
          if (isYAxis) {
            availableWidth = width - 2 * (xMin !== 0 || xMax !== 0 ? xMin + xMax : max(overflow.left, overflow.right));
          } else {
            availableHeight = height - 2 * (yMin !== 0 || yMax !== 0 ? yMin + yMax : max(overflow.top, overflow.bottom));
          }
        }
        await apply({
          ...state,
          availableWidth,
          availableHeight
        });
        const nextDimensions = await platform2.getDimensions(elements.floating);
        if (width !== nextDimensions.width || height !== nextDimensions.height) {
          return {
            reset: {
              rects: true
            }
          };
        }
        return {};
      }
    };
  };

  // ../../node_modules/.pnpm/@floating-ui+utils@0.2.8/node_modules/@floating-ui/utils/dist/floating-ui.utils.dom.mjs
  function hasWindow() {
    return typeof window !== "undefined";
  }
  function getNodeName(node) {
    if (isNode(node)) {
      return (node.nodeName || "").toLowerCase();
    }
    return "#document";
  }
  function getWindow(node) {
    var _node$ownerDocument;
    return (node == null || (_node$ownerDocument = node.ownerDocument) == null ? void 0 : _node$ownerDocument.defaultView) || window;
  }
  function getDocumentElement(node) {
    var _ref2;
    return (_ref2 = (isNode(node) ? node.ownerDocument : node.document) || window.document) == null ? void 0 : _ref2.documentElement;
  }
  function isNode(value) {
    if (!hasWindow()) {
      return false;
    }
    return value instanceof Node || value instanceof getWindow(value).Node;
  }
  function isElement(value) {
    if (!hasWindow()) {
      return false;
    }
    return value instanceof Element || value instanceof getWindow(value).Element;
  }
  function isHTMLElement(value) {
    if (!hasWindow()) {
      return false;
    }
    return value instanceof HTMLElement || value instanceof getWindow(value).HTMLElement;
  }
  function isShadowRoot(value) {
    if (!hasWindow() || typeof ShadowRoot === "undefined") {
      return false;
    }
    return value instanceof ShadowRoot || value instanceof getWindow(value).ShadowRoot;
  }
  function isOverflowElement(element) {
    const {
      overflow,
      overflowX,
      overflowY,
      display
    } = getComputedStyle2(element);
    return /auto|scroll|overlay|hidden|clip/.test(overflow + overflowY + overflowX) && !["inline", "contents"].includes(display);
  }
  function isTableElement(element) {
    return ["table", "td", "th"].includes(getNodeName(element));
  }
  function isTopLayer(element) {
    return [":popover-open", ":modal"].some((selector) => {
      try {
        return element.matches(selector);
      } catch (e15) {
        return false;
      }
    });
  }
  function isContainingBlock(elementOrCss) {
    const webkit = isWebKit();
    const css = isElement(elementOrCss) ? getComputedStyle2(elementOrCss) : elementOrCss;
    return css.transform !== "none" || css.perspective !== "none" || (css.containerType ? css.containerType !== "normal" : false) || !webkit && (css.backdropFilter ? css.backdropFilter !== "none" : false) || !webkit && (css.filter ? css.filter !== "none" : false) || ["transform", "perspective", "filter"].some((value) => (css.willChange || "").includes(value)) || ["paint", "layout", "strict", "content"].some((value) => (css.contain || "").includes(value));
  }
  function getContainingBlock(element) {
    let currentNode = getParentNode(element);
    while (isHTMLElement(currentNode) && !isLastTraversableNode(currentNode)) {
      if (isContainingBlock(currentNode)) {
        return currentNode;
      } else if (isTopLayer(currentNode)) {
        return null;
      }
      currentNode = getParentNode(currentNode);
    }
    return null;
  }
  function isWebKit() {
    if (typeof CSS === "undefined" || !CSS.supports) return false;
    return CSS.supports("-webkit-backdrop-filter", "none");
  }
  function isLastTraversableNode(node) {
    return ["html", "body", "#document"].includes(getNodeName(node));
  }
  function getComputedStyle2(element) {
    return getWindow(element).getComputedStyle(element);
  }
  function getNodeScroll(element) {
    if (isElement(element)) {
      return {
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop
      };
    }
    return {
      scrollLeft: element.scrollX,
      scrollTop: element.scrollY
    };
  }
  function getParentNode(node) {
    if (getNodeName(node) === "html") {
      return node;
    }
    const result = (
      // Step into the shadow DOM of the parent of a slotted node.
      node.assignedSlot || // DOM Element detected.
      node.parentNode || // ShadowRoot detected.
      isShadowRoot(node) && node.host || // Fallback.
      getDocumentElement(node)
    );
    return isShadowRoot(result) ? result.host : result;
  }
  function getNearestOverflowAncestor(node) {
    const parentNode = getParentNode(node);
    if (isLastTraversableNode(parentNode)) {
      return node.ownerDocument ? node.ownerDocument.body : node.body;
    }
    if (isHTMLElement(parentNode) && isOverflowElement(parentNode)) {
      return parentNode;
    }
    return getNearestOverflowAncestor(parentNode);
  }
  function getOverflowAncestors(node, list, traverseIframes) {
    var _node$ownerDocument2;
    if (list === void 0) {
      list = [];
    }
    if (traverseIframes === void 0) {
      traverseIframes = true;
    }
    const scrollableAncestor = getNearestOverflowAncestor(node);
    const isBody = scrollableAncestor === ((_node$ownerDocument2 = node.ownerDocument) == null ? void 0 : _node$ownerDocument2.body);
    const win = getWindow(scrollableAncestor);
    if (isBody) {
      const frameElement = getFrameElement(win);
      return list.concat(win, win.visualViewport || [], isOverflowElement(scrollableAncestor) ? scrollableAncestor : [], frameElement && traverseIframes ? getOverflowAncestors(frameElement) : []);
    }
    return list.concat(scrollableAncestor, getOverflowAncestors(scrollableAncestor, [], traverseIframes));
  }
  function getFrameElement(win) {
    return win.parent && Object.getPrototypeOf(win.parent) ? win.frameElement : null;
  }

  // ../../node_modules/.pnpm/@floating-ui+dom@1.6.12/node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
  function getCssDimensions(element) {
    const css = getComputedStyle2(element);
    let width = parseFloat(css.width) || 0;
    let height = parseFloat(css.height) || 0;
    const hasOffset = isHTMLElement(element);
    const offsetWidth = hasOffset ? element.offsetWidth : width;
    const offsetHeight = hasOffset ? element.offsetHeight : height;
    const shouldFallback = round(width) !== offsetWidth || round(height) !== offsetHeight;
    if (shouldFallback) {
      width = offsetWidth;
      height = offsetHeight;
    }
    return {
      width,
      height,
      $: shouldFallback
    };
  }
  function unwrapElement(element) {
    return !isElement(element) ? element.contextElement : element;
  }
  function getScale(element) {
    const domElement = unwrapElement(element);
    if (!isHTMLElement(domElement)) {
      return createCoords(1);
    }
    const rect = domElement.getBoundingClientRect();
    const {
      width,
      height,
      $
    } = getCssDimensions(domElement);
    let x = ($ ? round(rect.width) : rect.width) / width;
    let y = ($ ? round(rect.height) : rect.height) / height;
    if (!x || !Number.isFinite(x)) {
      x = 1;
    }
    if (!y || !Number.isFinite(y)) {
      y = 1;
    }
    return {
      x,
      y
    };
  }
  var noOffsets = /* @__PURE__ */ createCoords(0);
  function getVisualOffsets(element) {
    const win = getWindow(element);
    if (!isWebKit() || !win.visualViewport) {
      return noOffsets;
    }
    return {
      x: win.visualViewport.offsetLeft,
      y: win.visualViewport.offsetTop
    };
  }
  function shouldAddVisualOffsets(element, isFixed2, floatingOffsetParent) {
    if (isFixed2 === void 0) {
      isFixed2 = false;
    }
    if (!floatingOffsetParent || isFixed2 && floatingOffsetParent !== getWindow(element)) {
      return false;
    }
    return isFixed2;
  }
  function getBoundingClientRect(element, includeScale, isFixedStrategy, offsetParent) {
    if (includeScale === void 0) {
      includeScale = false;
    }
    if (isFixedStrategy === void 0) {
      isFixedStrategy = false;
    }
    const clientRect = element.getBoundingClientRect();
    const domElement = unwrapElement(element);
    let scale = createCoords(1);
    if (includeScale) {
      if (offsetParent) {
        if (isElement(offsetParent)) {
          scale = getScale(offsetParent);
        }
      } else {
        scale = getScale(element);
      }
    }
    const visualOffsets = shouldAddVisualOffsets(domElement, isFixedStrategy, offsetParent) ? getVisualOffsets(domElement) : createCoords(0);
    let x = (clientRect.left + visualOffsets.x) / scale.x;
    let y = (clientRect.top + visualOffsets.y) / scale.y;
    let width = clientRect.width / scale.x;
    let height = clientRect.height / scale.y;
    if (domElement) {
      const win = getWindow(domElement);
      const offsetWin = offsetParent && isElement(offsetParent) ? getWindow(offsetParent) : offsetParent;
      let currentWin = win;
      let currentIFrame = getFrameElement(currentWin);
      while (currentIFrame && offsetParent && offsetWin !== currentWin) {
        const iframeScale = getScale(currentIFrame);
        const iframeRect = currentIFrame.getBoundingClientRect();
        const css = getComputedStyle2(currentIFrame);
        const left = iframeRect.left + (currentIFrame.clientLeft + parseFloat(css.paddingLeft)) * iframeScale.x;
        const top = iframeRect.top + (currentIFrame.clientTop + parseFloat(css.paddingTop)) * iframeScale.y;
        x *= iframeScale.x;
        y *= iframeScale.y;
        width *= iframeScale.x;
        height *= iframeScale.y;
        x += left;
        y += top;
        currentWin = getWindow(currentIFrame);
        currentIFrame = getFrameElement(currentWin);
      }
    }
    return rectToClientRect({
      width,
      height,
      x,
      y
    });
  }
  function getWindowScrollBarX(element, rect) {
    const leftScroll = getNodeScroll(element).scrollLeft;
    if (!rect) {
      return getBoundingClientRect(getDocumentElement(element)).left + leftScroll;
    }
    return rect.left + leftScroll;
  }
  function getHTMLOffset(documentElement, scroll, ignoreScrollbarX) {
    if (ignoreScrollbarX === void 0) {
      ignoreScrollbarX = false;
    }
    const htmlRect = documentElement.getBoundingClientRect();
    const x = htmlRect.left + scroll.scrollLeft - (ignoreScrollbarX ? 0 : (
      // RTL <body> scrollbar.
      getWindowScrollBarX(documentElement, htmlRect)
    ));
    const y = htmlRect.top + scroll.scrollTop;
    return {
      x,
      y
    };
  }
  function convertOffsetParentRelativeRectToViewportRelativeRect(_ref2) {
    let {
      elements,
      rect,
      offsetParent,
      strategy
    } = _ref2;
    const isFixed2 = strategy === "fixed";
    const documentElement = getDocumentElement(offsetParent);
    const topLayer = elements ? isTopLayer(elements.floating) : false;
    if (offsetParent === documentElement || topLayer && isFixed2) {
      return rect;
    }
    let scroll = {
      scrollLeft: 0,
      scrollTop: 0
    };
    let scale = createCoords(1);
    const offsets = createCoords(0);
    const isOffsetParentAnElement = isHTMLElement(offsetParent);
    if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed2) {
      if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) {
        scroll = getNodeScroll(offsetParent);
      }
      if (isHTMLElement(offsetParent)) {
        const offsetRect = getBoundingClientRect(offsetParent);
        scale = getScale(offsetParent);
        offsets.x = offsetRect.x + offsetParent.clientLeft;
        offsets.y = offsetRect.y + offsetParent.clientTop;
      }
    }
    const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed2 ? getHTMLOffset(documentElement, scroll, true) : createCoords(0);
    return {
      width: rect.width * scale.x,
      height: rect.height * scale.y,
      x: rect.x * scale.x - scroll.scrollLeft * scale.x + offsets.x + htmlOffset.x,
      y: rect.y * scale.y - scroll.scrollTop * scale.y + offsets.y + htmlOffset.y
    };
  }
  function getClientRects(element) {
    return Array.from(element.getClientRects());
  }
  function getDocumentRect(element) {
    const html = getDocumentElement(element);
    const scroll = getNodeScroll(element);
    const body = element.ownerDocument.body;
    const width = max(html.scrollWidth, html.clientWidth, body.scrollWidth, body.clientWidth);
    const height = max(html.scrollHeight, html.clientHeight, body.scrollHeight, body.clientHeight);
    let x = -scroll.scrollLeft + getWindowScrollBarX(element);
    const y = -scroll.scrollTop;
    if (getComputedStyle2(body).direction === "rtl") {
      x += max(html.clientWidth, body.clientWidth) - width;
    }
    return {
      width,
      height,
      x,
      y
    };
  }
  function getViewportRect(element, strategy) {
    const win = getWindow(element);
    const html = getDocumentElement(element);
    const visualViewport = win.visualViewport;
    let width = html.clientWidth;
    let height = html.clientHeight;
    let x = 0;
    let y = 0;
    if (visualViewport) {
      width = visualViewport.width;
      height = visualViewport.height;
      const visualViewportBased = isWebKit();
      if (!visualViewportBased || visualViewportBased && strategy === "fixed") {
        x = visualViewport.offsetLeft;
        y = visualViewport.offsetTop;
      }
    }
    return {
      width,
      height,
      x,
      y
    };
  }
  function getInnerBoundingClientRect(element, strategy) {
    const clientRect = getBoundingClientRect(element, true, strategy === "fixed");
    const top = clientRect.top + element.clientTop;
    const left = clientRect.left + element.clientLeft;
    const scale = isHTMLElement(element) ? getScale(element) : createCoords(1);
    const width = element.clientWidth * scale.x;
    const height = element.clientHeight * scale.y;
    const x = left * scale.x;
    const y = top * scale.y;
    return {
      width,
      height,
      x,
      y
    };
  }
  function getClientRectFromClippingAncestor(element, clippingAncestor, strategy) {
    let rect;
    if (clippingAncestor === "viewport") {
      rect = getViewportRect(element, strategy);
    } else if (clippingAncestor === "document") {
      rect = getDocumentRect(getDocumentElement(element));
    } else if (isElement(clippingAncestor)) {
      rect = getInnerBoundingClientRect(clippingAncestor, strategy);
    } else {
      const visualOffsets = getVisualOffsets(element);
      rect = {
        x: clippingAncestor.x - visualOffsets.x,
        y: clippingAncestor.y - visualOffsets.y,
        width: clippingAncestor.width,
        height: clippingAncestor.height
      };
    }
    return rectToClientRect(rect);
  }
  function hasFixedPositionAncestor(element, stopNode) {
    const parentNode = getParentNode(element);
    if (parentNode === stopNode || !isElement(parentNode) || isLastTraversableNode(parentNode)) {
      return false;
    }
    return getComputedStyle2(parentNode).position === "fixed" || hasFixedPositionAncestor(parentNode, stopNode);
  }
  function getClippingElementAncestors(element, cache) {
    const cachedResult = cache.get(element);
    if (cachedResult) {
      return cachedResult;
    }
    let result = getOverflowAncestors(element, [], false).filter((el) => isElement(el) && getNodeName(el) !== "body");
    let currentContainingBlockComputedStyle = null;
    const elementIsFixed = getComputedStyle2(element).position === "fixed";
    let currentNode = elementIsFixed ? getParentNode(element) : element;
    while (isElement(currentNode) && !isLastTraversableNode(currentNode)) {
      const computedStyle = getComputedStyle2(currentNode);
      const currentNodeIsContaining = isContainingBlock(currentNode);
      if (!currentNodeIsContaining && computedStyle.position === "fixed") {
        currentContainingBlockComputedStyle = null;
      }
      const shouldDropCurrentNode = elementIsFixed ? !currentNodeIsContaining && !currentContainingBlockComputedStyle : !currentNodeIsContaining && computedStyle.position === "static" && !!currentContainingBlockComputedStyle && ["absolute", "fixed"].includes(currentContainingBlockComputedStyle.position) || isOverflowElement(currentNode) && !currentNodeIsContaining && hasFixedPositionAncestor(element, currentNode);
      if (shouldDropCurrentNode) {
        result = result.filter((ancestor) => ancestor !== currentNode);
      } else {
        currentContainingBlockComputedStyle = computedStyle;
      }
      currentNode = getParentNode(currentNode);
    }
    cache.set(element, result);
    return result;
  }
  function getClippingRect(_ref2) {
    let {
      element,
      boundary,
      rootBoundary,
      strategy
    } = _ref2;
    const elementClippingAncestors = boundary === "clippingAncestors" ? isTopLayer(element) ? [] : getClippingElementAncestors(element, this._c) : [].concat(boundary);
    const clippingAncestors = [...elementClippingAncestors, rootBoundary];
    const firstClippingAncestor = clippingAncestors[0];
    const clippingRect = clippingAncestors.reduce((accRect, clippingAncestor) => {
      const rect = getClientRectFromClippingAncestor(element, clippingAncestor, strategy);
      accRect.top = max(rect.top, accRect.top);
      accRect.right = min(rect.right, accRect.right);
      accRect.bottom = min(rect.bottom, accRect.bottom);
      accRect.left = max(rect.left, accRect.left);
      return accRect;
    }, getClientRectFromClippingAncestor(element, firstClippingAncestor, strategy));
    return {
      width: clippingRect.right - clippingRect.left,
      height: clippingRect.bottom - clippingRect.top,
      x: clippingRect.left,
      y: clippingRect.top
    };
  }
  function getDimensions(element) {
    const {
      width,
      height
    } = getCssDimensions(element);
    return {
      width,
      height
    };
  }
  function getRectRelativeToOffsetParent(element, offsetParent, strategy) {
    const isOffsetParentAnElement = isHTMLElement(offsetParent);
    const documentElement = getDocumentElement(offsetParent);
    const isFixed2 = strategy === "fixed";
    const rect = getBoundingClientRect(element, true, isFixed2, offsetParent);
    let scroll = {
      scrollLeft: 0,
      scrollTop: 0
    };
    const offsets = createCoords(0);
    if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed2) {
      if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) {
        scroll = getNodeScroll(offsetParent);
      }
      if (isOffsetParentAnElement) {
        const offsetRect = getBoundingClientRect(offsetParent, true, isFixed2, offsetParent);
        offsets.x = offsetRect.x + offsetParent.clientLeft;
        offsets.y = offsetRect.y + offsetParent.clientTop;
      } else if (documentElement) {
        offsets.x = getWindowScrollBarX(documentElement);
      }
    }
    const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed2 ? getHTMLOffset(documentElement, scroll) : createCoords(0);
    const x = rect.left + scroll.scrollLeft - offsets.x - htmlOffset.x;
    const y = rect.top + scroll.scrollTop - offsets.y - htmlOffset.y;
    return {
      x,
      y,
      width: rect.width,
      height: rect.height
    };
  }
  function isStaticPositioned(element) {
    return getComputedStyle2(element).position === "static";
  }
  function getTrueOffsetParent(element, polyfill) {
    if (!isHTMLElement(element) || getComputedStyle2(element).position === "fixed") {
      return null;
    }
    if (polyfill) {
      return polyfill(element);
    }
    let rawOffsetParent = element.offsetParent;
    if (getDocumentElement(element) === rawOffsetParent) {
      rawOffsetParent = rawOffsetParent.ownerDocument.body;
    }
    return rawOffsetParent;
  }
  function getOffsetParent(element, polyfill) {
    const win = getWindow(element);
    if (isTopLayer(element)) {
      return win;
    }
    if (!isHTMLElement(element)) {
      let svgOffsetParent = getParentNode(element);
      while (svgOffsetParent && !isLastTraversableNode(svgOffsetParent)) {
        if (isElement(svgOffsetParent) && !isStaticPositioned(svgOffsetParent)) {
          return svgOffsetParent;
        }
        svgOffsetParent = getParentNode(svgOffsetParent);
      }
      return win;
    }
    let offsetParent = getTrueOffsetParent(element, polyfill);
    while (offsetParent && isTableElement(offsetParent) && isStaticPositioned(offsetParent)) {
      offsetParent = getTrueOffsetParent(offsetParent, polyfill);
    }
    if (offsetParent && isLastTraversableNode(offsetParent) && isStaticPositioned(offsetParent) && !isContainingBlock(offsetParent)) {
      return win;
    }
    return offsetParent || getContainingBlock(element) || win;
  }
  var getElementRects = async function(data) {
    const getOffsetParentFn = this.getOffsetParent || getOffsetParent;
    const getDimensionsFn = this.getDimensions;
    const floatingDimensions = await getDimensionsFn(data.floating);
    return {
      reference: getRectRelativeToOffsetParent(data.reference, await getOffsetParentFn(data.floating), data.strategy),
      floating: {
        x: 0,
        y: 0,
        width: floatingDimensions.width,
        height: floatingDimensions.height
      }
    };
  };
  function isRTL(element) {
    return getComputedStyle2(element).direction === "rtl";
  }
  var platform = {
    convertOffsetParentRelativeRectToViewportRelativeRect,
    getDocumentElement,
    getClippingRect,
    getOffsetParent,
    getElementRects,
    getClientRects,
    getDimensions,
    getScale,
    isElement,
    isRTL
  };
  function observeMove(element, onMove) {
    let io = null;
    let timeoutId;
    const root = getDocumentElement(element);
    function cleanup() {
      var _io;
      clearTimeout(timeoutId);
      (_io = io) == null || _io.disconnect();
      io = null;
    }
    function refresh(skip, threshold) {
      if (skip === void 0) {
        skip = false;
      }
      if (threshold === void 0) {
        threshold = 1;
      }
      cleanup();
      const {
        left,
        top,
        width,
        height
      } = element.getBoundingClientRect();
      if (!skip) {
        onMove();
      }
      if (!width || !height) {
        return;
      }
      const insetTop = floor(top);
      const insetRight = floor(root.clientWidth - (left + width));
      const insetBottom = floor(root.clientHeight - (top + height));
      const insetLeft = floor(left);
      const rootMargin = -insetTop + "px " + -insetRight + "px " + -insetBottom + "px " + -insetLeft + "px";
      const options = {
        rootMargin,
        threshold: max(0, min(1, threshold)) || 1
      };
      let isFirstUpdate = true;
      function handleObserve(entries) {
        const ratio = entries[0].intersectionRatio;
        if (ratio !== threshold) {
          if (!isFirstUpdate) {
            return refresh();
          }
          if (!ratio) {
            timeoutId = setTimeout(() => {
              refresh(false, 1e-7);
            }, 1e3);
          } else {
            refresh(false, ratio);
          }
        }
        isFirstUpdate = false;
      }
      try {
        io = new IntersectionObserver(handleObserve, {
          ...options,
          // Handle <iframe>s
          root: root.ownerDocument
        });
      } catch (e15) {
        io = new IntersectionObserver(handleObserve, options);
      }
      io.observe(element);
    }
    refresh(true);
    return cleanup;
  }
  function autoUpdate(reference, floating, update, options) {
    if (options === void 0) {
      options = {};
    }
    const {
      ancestorScroll = true,
      ancestorResize = true,
      elementResize = typeof ResizeObserver === "function",
      layoutShift = typeof IntersectionObserver === "function",
      animationFrame = false
    } = options;
    const referenceEl = unwrapElement(reference);
    const ancestors = ancestorScroll || ancestorResize ? [...referenceEl ? getOverflowAncestors(referenceEl) : [], ...getOverflowAncestors(floating)] : [];
    ancestors.forEach((ancestor) => {
      ancestorScroll && ancestor.addEventListener("scroll", update, {
        passive: true
      });
      ancestorResize && ancestor.addEventListener("resize", update);
    });
    const cleanupIo = referenceEl && layoutShift ? observeMove(referenceEl, update) : null;
    let reobserveFrame = -1;
    let resizeObserver = null;
    if (elementResize) {
      resizeObserver = new ResizeObserver((_ref2) => {
        let [firstEntry] = _ref2;
        if (firstEntry && firstEntry.target === referenceEl && resizeObserver) {
          resizeObserver.unobserve(floating);
          cancelAnimationFrame(reobserveFrame);
          reobserveFrame = requestAnimationFrame(() => {
            var _resizeObserver2;
            (_resizeObserver2 = resizeObserver) == null || _resizeObserver2.observe(floating);
          });
        }
        update();
      });
      if (referenceEl && !animationFrame) {
        resizeObserver.observe(referenceEl);
      }
      resizeObserver.observe(floating);
    }
    let frameId;
    let prevRefRect = animationFrame ? getBoundingClientRect(reference) : null;
    if (animationFrame) {
      frameLoop();
    }
    function frameLoop() {
      const nextRefRect = getBoundingClientRect(reference);
      if (prevRefRect && (nextRefRect.x !== prevRefRect.x || nextRefRect.y !== prevRefRect.y || nextRefRect.width !== prevRefRect.width || nextRefRect.height !== prevRefRect.height)) {
        update();
      }
      prevRefRect = nextRefRect;
      frameId = requestAnimationFrame(frameLoop);
    }
    update();
    return () => {
      var _resizeObserver2;
      ancestors.forEach((ancestor) => {
        ancestorScroll && ancestor.removeEventListener("scroll", update);
        ancestorResize && ancestor.removeEventListener("resize", update);
      });
      cleanupIo == null || cleanupIo();
      (_resizeObserver2 = resizeObserver) == null || _resizeObserver2.disconnect();
      resizeObserver = null;
      if (animationFrame) {
        cancelAnimationFrame(frameId);
      }
    };
  }
  var offset2 = offset;
  var shift2 = shift;
  var flip2 = flip;
  var size2 = size;
  var hide2 = hide;
  var arrow2 = arrow;
  var limitShift2 = limitShift;
  var computePosition2 = (reference, floating, options) => {
    const cache = /* @__PURE__ */ new Map();
    const mergedOptions = {
      platform,
      ...options
    };
    const platformWithCache = {
      ...mergedOptions.platform,
      _c: cache
    };
    return computePosition(reference, floating, {
      ...mergedOptions,
      platform: platformWithCache
    });
  };

  // ../../node_modules/.pnpm/@floating-ui+react-dom@2.1.2_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@floating-ui/react-dom/dist/floating-ui.react-dom.mjs
  var React17 = __toESM(require_react(), 1);
  var import_react8 = __toESM(require_react(), 1);
  var ReactDOM2 = __toESM(require_react_dom(), 1);
  var index = typeof document !== "undefined" ? import_react8.useLayoutEffect : import_react8.useEffect;
  function deepEqual(a8, b) {
    if (a8 === b) {
      return true;
    }
    if (typeof a8 !== typeof b) {
      return false;
    }
    if (typeof a8 === "function" && a8.toString() === b.toString()) {
      return true;
    }
    let length;
    let i;
    let keys;
    if (a8 && b && typeof a8 === "object") {
      if (Array.isArray(a8)) {
        length = a8.length;
        if (length !== b.length) return false;
        for (i = length; i-- !== 0; ) {
          if (!deepEqual(a8[i], b[i])) {
            return false;
          }
        }
        return true;
      }
      keys = Object.keys(a8);
      length = keys.length;
      if (length !== Object.keys(b).length) {
        return false;
      }
      for (i = length; i-- !== 0; ) {
        if (!{}.hasOwnProperty.call(b, keys[i])) {
          return false;
        }
      }
      for (i = length; i-- !== 0; ) {
        const key = keys[i];
        if (key === "_owner" && a8.$$typeof) {
          continue;
        }
        if (!deepEqual(a8[key], b[key])) {
          return false;
        }
      }
      return true;
    }
    return a8 !== a8 && b !== b;
  }
  function getDPR(element) {
    if (typeof window === "undefined") {
      return 1;
    }
    const win = element.ownerDocument.defaultView || window;
    return win.devicePixelRatio || 1;
  }
  function roundByDPR(element, value) {
    const dpr = getDPR(element);
    return Math.round(value * dpr) / dpr;
  }
  function useLatestRef(value) {
    const ref = React17.useRef(value);
    index(() => {
      ref.current = value;
    });
    return ref;
  }
  function useFloating(options) {
    if (options === void 0) {
      options = {};
    }
    const {
      placement = "bottom",
      strategy = "absolute",
      middleware = [],
      platform: platform2,
      elements: {
        reference: externalReference,
        floating: externalFloating
      } = {},
      transform = true,
      whileElementsMounted,
      open
    } = options;
    const [data, setData] = React17.useState({
      x: 0,
      y: 0,
      strategy,
      placement,
      middlewareData: {},
      isPositioned: false
    });
    const [latestMiddleware, setLatestMiddleware] = React17.useState(middleware);
    if (!deepEqual(latestMiddleware, middleware)) {
      setLatestMiddleware(middleware);
    }
    const [_reference, _setReference] = React17.useState(null);
    const [_floating, _setFloating] = React17.useState(null);
    const setReference = React17.useCallback((node) => {
      if (node !== referenceRef.current) {
        referenceRef.current = node;
        _setReference(node);
      }
    }, []);
    const setFloating = React17.useCallback((node) => {
      if (node !== floatingRef.current) {
        floatingRef.current = node;
        _setFloating(node);
      }
    }, []);
    const referenceEl = externalReference || _reference;
    const floatingEl = externalFloating || _floating;
    const referenceRef = React17.useRef(null);
    const floatingRef = React17.useRef(null);
    const dataRef = React17.useRef(data);
    const hasWhileElementsMounted = whileElementsMounted != null;
    const whileElementsMountedRef = useLatestRef(whileElementsMounted);
    const platformRef = useLatestRef(platform2);
    const openRef = useLatestRef(open);
    const update = React17.useCallback(() => {
      if (!referenceRef.current || !floatingRef.current) {
        return;
      }
      const config = {
        placement,
        strategy,
        middleware: latestMiddleware
      };
      if (platformRef.current) {
        config.platform = platformRef.current;
      }
      computePosition2(referenceRef.current, floatingRef.current, config).then((data2) => {
        const fullData = {
          ...data2,
          // The floating element's position may be recomputed while it's closed
          // but still mounted (such as when transitioning out). To ensure
          // `isPositioned` will be `false` initially on the next open, avoid
          // setting it to `true` when `open === false` (must be specified).
          isPositioned: openRef.current !== false
        };
        if (isMountedRef.current && !deepEqual(dataRef.current, fullData)) {
          dataRef.current = fullData;
          ReactDOM2.flushSync(() => {
            setData(fullData);
          });
        }
      });
    }, [latestMiddleware, placement, strategy, platformRef, openRef]);
    index(() => {
      if (open === false && dataRef.current.isPositioned) {
        dataRef.current.isPositioned = false;
        setData((data2) => ({
          ...data2,
          isPositioned: false
        }));
      }
    }, [open]);
    const isMountedRef = React17.useRef(false);
    index(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
      };
    }, []);
    index(() => {
      if (referenceEl) referenceRef.current = referenceEl;
      if (floatingEl) floatingRef.current = floatingEl;
      if (referenceEl && floatingEl) {
        if (whileElementsMountedRef.current) {
          return whileElementsMountedRef.current(referenceEl, floatingEl, update);
        }
        update();
      }
    }, [referenceEl, floatingEl, update, whileElementsMountedRef, hasWhileElementsMounted]);
    const refs = React17.useMemo(() => ({
      reference: referenceRef,
      floating: floatingRef,
      setReference,
      setFloating
    }), [setReference, setFloating]);
    const elements = React17.useMemo(() => ({
      reference: referenceEl,
      floating: floatingEl
    }), [referenceEl, floatingEl]);
    const floatingStyles = React17.useMemo(() => {
      const initialStyles = {
        position: strategy,
        left: 0,
        top: 0
      };
      if (!elements.floating) {
        return initialStyles;
      }
      const x = roundByDPR(elements.floating, data.x);
      const y = roundByDPR(elements.floating, data.y);
      if (transform) {
        return {
          ...initialStyles,
          transform: "translate(" + x + "px, " + y + "px)",
          ...getDPR(elements.floating) >= 1.5 && {
            willChange: "transform"
          }
        };
      }
      return {
        position: strategy,
        left: x,
        top: y
      };
    }, [strategy, transform, elements.floating, data.x, data.y]);
    return React17.useMemo(() => ({
      ...data,
      update,
      refs,
      elements,
      floatingStyles
    }), [data, update, refs, elements, floatingStyles]);
  }
  var arrow$1 = (options) => {
    function isRef(value) {
      return {}.hasOwnProperty.call(value, "current");
    }
    return {
      name: "arrow",
      options,
      fn(state) {
        const {
          element,
          padding
        } = typeof options === "function" ? options(state) : options;
        if (element && isRef(element)) {
          if (element.current != null) {
            return arrow2({
              element: element.current,
              padding
            }).fn(state);
          }
          return {};
        }
        if (element) {
          return arrow2({
            element,
            padding
          }).fn(state);
        }
        return {};
      }
    };
  };
  var offset3 = (options, deps) => ({
    ...offset2(options),
    options: [options, deps]
  });
  var shift3 = (options, deps) => ({
    ...shift2(options),
    options: [options, deps]
  });
  var limitShift3 = (options, deps) => ({
    ...limitShift2(options),
    options: [options, deps]
  });
  var flip3 = (options, deps) => ({
    ...flip2(options),
    options: [options, deps]
  });
  var size3 = (options, deps) => ({
    ...size2(options),
    options: [options, deps]
  });
  var hide3 = (options, deps) => ({
    ...hide2(options),
    options: [options, deps]
  });
  var arrow3 = (options, deps) => ({
    ...arrow$1(options),
    options: [options, deps]
  });

  // ../../node_modules/.pnpm/@radix-ui+react-arrow@1.1.0_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-arrow/dist/index.mjs
  var React18 = __toESM(require_react(), 1);
  var NAME = "Arrow";
  var Arrow = React18.forwardRef((props, forwardedRef) => {
    const { children, width = 10, height = 5, ...arrowProps } = props;
    return /* @__PURE__ */ jsx(
      Primitive.svg,
      {
        ...arrowProps,
        ref: forwardedRef,
        width,
        height,
        viewBox: "0 0 30 10",
        preserveAspectRatio: "none",
        children: props.asChild ? children : /* @__PURE__ */ jsx("polygon", { points: "0,0 30,0 15,10" })
      }
    );
  });
  Arrow.displayName = NAME;
  var Root = Arrow;

  // ../../node_modules/.pnpm/@radix-ui+react-use-size@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-use-size/dist/index.mjs
  var React19 = __toESM(require_react(), 1);
  function useSize(element) {
    const [size5, setSize] = React19.useState(void 0);
    useLayoutEffect2(() => {
      if (element) {
        setSize({ width: element.offsetWidth, height: element.offsetHeight });
        const resizeObserver = new ResizeObserver((entries) => {
          if (!Array.isArray(entries)) {
            return;
          }
          if (!entries.length) {
            return;
          }
          const entry = entries[0];
          let width;
          let height;
          if ("borderBoxSize" in entry) {
            const borderSizeEntry = entry["borderBoxSize"];
            const borderSize = Array.isArray(borderSizeEntry) ? borderSizeEntry[0] : borderSizeEntry;
            width = borderSize["inlineSize"];
            height = borderSize["blockSize"];
          } else {
            width = element.offsetWidth;
            height = element.offsetHeight;
          }
          setSize({ width, height });
        });
        resizeObserver.observe(element, { box: "border-box" });
        return () => resizeObserver.unobserve(element);
      } else {
        setSize(void 0);
      }
    }, [element]);
    return size5;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-popper@1.2.0_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-popper/dist/index.mjs
  var POPPER_NAME = "Popper";
  var [createPopperContext, createPopperScope] = createContextScope(POPPER_NAME);
  var [PopperProvider, usePopperContext] = createPopperContext(POPPER_NAME);
  var Popper = (props) => {
    const { __scopePopper, children } = props;
    const [anchor, setAnchor] = React20.useState(null);
    return /* @__PURE__ */ jsx(PopperProvider, { scope: __scopePopper, anchor, onAnchorChange: setAnchor, children });
  };
  Popper.displayName = POPPER_NAME;
  var ANCHOR_NAME = "PopperAnchor";
  var PopperAnchor = React20.forwardRef(
    (props, forwardedRef) => {
      const { __scopePopper, virtualRef, ...anchorProps } = props;
      const context = usePopperContext(ANCHOR_NAME, __scopePopper);
      const ref = React20.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, ref);
      React20.useEffect(() => {
        context.onAnchorChange(virtualRef?.current || ref.current);
      });
      return virtualRef ? null : /* @__PURE__ */ jsx(Primitive.div, { ...anchorProps, ref: composedRefs });
    }
  );
  PopperAnchor.displayName = ANCHOR_NAME;
  var CONTENT_NAME = "PopperContent";
  var [PopperContentProvider, useContentContext] = createPopperContext(CONTENT_NAME);
  var PopperContent = React20.forwardRef(
    (props, forwardedRef) => {
      const {
        __scopePopper,
        side = "bottom",
        sideOffset = 0,
        align = "center",
        alignOffset = 0,
        arrowPadding = 0,
        avoidCollisions = true,
        collisionBoundary = [],
        collisionPadding: collisionPaddingProp = 0,
        sticky = "partial",
        hideWhenDetached = false,
        updatePositionStrategy = "optimized",
        onPlaced,
        ...contentProps
      } = props;
      const context = usePopperContext(CONTENT_NAME, __scopePopper);
      const [content, setContent] = React20.useState(null);
      const composedRefs = useComposedRefs(forwardedRef, (node) => setContent(node));
      const [arrow5, setArrow] = React20.useState(null);
      const arrowSize = useSize(arrow5);
      const arrowWidth = arrowSize?.width ?? 0;
      const arrowHeight = arrowSize?.height ?? 0;
      const desiredPlacement = side + (align !== "center" ? "-" + align : "");
      const collisionPadding = typeof collisionPaddingProp === "number" ? collisionPaddingProp : { top: 0, right: 0, bottom: 0, left: 0, ...collisionPaddingProp };
      const boundary = Array.isArray(collisionBoundary) ? collisionBoundary : [collisionBoundary];
      const hasExplicitBoundaries = boundary.length > 0;
      const detectOverflowOptions = {
        padding: collisionPadding,
        boundary: boundary.filter(isNotNull2),
        // with `strategy: 'fixed'`, this is the only way to get it to respect boundaries
        altBoundary: hasExplicitBoundaries
      };
      const { refs, floatingStyles, placement, isPositioned, middlewareData } = useFloating({
        // default to `fixed` strategy so users don't have to pick and we also avoid focus scroll issues
        strategy: "fixed",
        placement: desiredPlacement,
        whileElementsMounted: (...args) => {
          const cleanup = autoUpdate(...args, {
            animationFrame: updatePositionStrategy === "always"
          });
          return cleanup;
        },
        elements: {
          reference: context.anchor
        },
        middleware: [
          offset3({ mainAxis: sideOffset + arrowHeight, alignmentAxis: alignOffset }),
          avoidCollisions && shift3({
            mainAxis: true,
            crossAxis: false,
            limiter: sticky === "partial" ? limitShift3() : void 0,
            ...detectOverflowOptions
          }),
          avoidCollisions && flip3({ ...detectOverflowOptions }),
          size3({
            ...detectOverflowOptions,
            apply: ({ elements, rects, availableWidth, availableHeight }) => {
              const { width: anchorWidth, height: anchorHeight } = rects.reference;
              const contentStyle = elements.floating.style;
              contentStyle.setProperty("--radix-popper-available-width", `${availableWidth}px`);
              contentStyle.setProperty("--radix-popper-available-height", `${availableHeight}px`);
              contentStyle.setProperty("--radix-popper-anchor-width", `${anchorWidth}px`);
              contentStyle.setProperty("--radix-popper-anchor-height", `${anchorHeight}px`);
            }
          }),
          arrow5 && arrow3({ element: arrow5, padding: arrowPadding }),
          transformOrigin({ arrowWidth, arrowHeight }),
          hideWhenDetached && hide3({ strategy: "referenceHidden", ...detectOverflowOptions })
        ]
      });
      const [placedSide, placedAlign] = getSideAndAlignFromPlacement(placement);
      const handlePlaced = useCallbackRef(onPlaced);
      useLayoutEffect2(() => {
        if (isPositioned) {
          handlePlaced?.();
        }
      }, [isPositioned, handlePlaced]);
      const arrowX = middlewareData.arrow?.x;
      const arrowY = middlewareData.arrow?.y;
      const cannotCenterArrow = middlewareData.arrow?.centerOffset !== 0;
      const [contentZIndex, setContentZIndex] = React20.useState();
      useLayoutEffect2(() => {
        if (content) setContentZIndex(window.getComputedStyle(content).zIndex);
      }, [content]);
      return /* @__PURE__ */ jsx(
        "div",
        {
          ref: refs.setFloating,
          "data-radix-popper-content-wrapper": "",
          style: {
            ...floatingStyles,
            transform: isPositioned ? floatingStyles.transform : "translate(0, -200%)",
            // keep off the page when measuring
            minWidth: "max-content",
            zIndex: contentZIndex,
            ["--radix-popper-transform-origin"]: [
              middlewareData.transformOrigin?.x,
              middlewareData.transformOrigin?.y
            ].join(" "),
            // hide the content if using the hide middleware and should be hidden
            // set visibility to hidden and disable pointer events so the UI behaves
            // as if the PopperContent isn't there at all
            ...middlewareData.hide?.referenceHidden && {
              visibility: "hidden",
              pointerEvents: "none"
            }
          },
          dir: props.dir,
          children: /* @__PURE__ */ jsx(
            PopperContentProvider,
            {
              scope: __scopePopper,
              placedSide,
              onArrowChange: setArrow,
              arrowX,
              arrowY,
              shouldHideArrow: cannotCenterArrow,
              children: /* @__PURE__ */ jsx(
                Primitive.div,
                {
                  "data-side": placedSide,
                  "data-align": placedAlign,
                  ...contentProps,
                  ref: composedRefs,
                  style: {
                    ...contentProps.style,
                    // if the PopperContent hasn't been placed yet (not all measurements done)
                    // we prevent animations so that users's animation don't kick in too early referring wrong sides
                    animation: !isPositioned ? "none" : void 0
                  }
                }
              )
            }
          )
        }
      );
    }
  );
  PopperContent.displayName = CONTENT_NAME;
  var ARROW_NAME = "PopperArrow";
  var OPPOSITE_SIDE = {
    top: "bottom",
    right: "left",
    bottom: "top",
    left: "right"
  };
  var PopperArrow = React20.forwardRef(function PopperArrow2(props, forwardedRef) {
    const { __scopePopper, ...arrowProps } = props;
    const contentContext = useContentContext(ARROW_NAME, __scopePopper);
    const baseSide = OPPOSITE_SIDE[contentContext.placedSide];
    return (
      // we have to use an extra wrapper because `ResizeObserver` (used by `useSize`)
      // doesn't report size as we'd expect on SVG elements.
      // it reports their bounding box which is effectively the largest path inside the SVG.
      /* @__PURE__ */ jsx(
        "span",
        {
          ref: contentContext.onArrowChange,
          style: {
            position: "absolute",
            left: contentContext.arrowX,
            top: contentContext.arrowY,
            [baseSide]: 0,
            transformOrigin: {
              top: "",
              right: "0 0",
              bottom: "center 0",
              left: "100% 0"
            }[contentContext.placedSide],
            transform: {
              top: "translateY(100%)",
              right: "translateY(50%) rotate(90deg) translateX(-50%)",
              bottom: `rotate(180deg)`,
              left: "translateY(50%) rotate(-90deg) translateX(50%)"
            }[contentContext.placedSide],
            visibility: contentContext.shouldHideArrow ? "hidden" : void 0
          },
          children: /* @__PURE__ */ jsx(
            Root,
            {
              ...arrowProps,
              ref: forwardedRef,
              style: {
                ...arrowProps.style,
                // ensures the element can be measured correctly (mostly for if SVG)
                display: "block"
              }
            }
          )
        }
      )
    );
  });
  PopperArrow.displayName = ARROW_NAME;
  function isNotNull2(value) {
    return value !== null;
  }
  var transformOrigin = (options) => ({
    name: "transformOrigin",
    options,
    fn(data) {
      const { placement, rects, middlewareData } = data;
      const cannotCenterArrow = middlewareData.arrow?.centerOffset !== 0;
      const isArrowHidden = cannotCenterArrow;
      const arrowWidth = isArrowHidden ? 0 : options.arrowWidth;
      const arrowHeight = isArrowHidden ? 0 : options.arrowHeight;
      const [placedSide, placedAlign] = getSideAndAlignFromPlacement(placement);
      const noArrowAlign = { start: "0%", center: "50%", end: "100%" }[placedAlign];
      const arrowXCenter = (middlewareData.arrow?.x ?? 0) + arrowWidth / 2;
      const arrowYCenter = (middlewareData.arrow?.y ?? 0) + arrowHeight / 2;
      let x = "";
      let y = "";
      if (placedSide === "bottom") {
        x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
        y = `${-arrowHeight}px`;
      } else if (placedSide === "top") {
        x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
        y = `${rects.floating.height + arrowHeight}px`;
      } else if (placedSide === "right") {
        x = `${-arrowHeight}px`;
        y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
      } else if (placedSide === "left") {
        x = `${rects.floating.width + arrowHeight}px`;
        y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
      }
      return { data: { x, y } };
    }
  });
  function getSideAndAlignFromPlacement(placement) {
    const [side, align = "center"] = placement.split("-");
    return [side, align];
  }
  var Root2 = Popper;
  var Anchor = PopperAnchor;
  var Content = PopperContent;
  var Arrow2 = PopperArrow;

  // ../../node_modules/.pnpm/@radix-ui+react-portal@1.1.2_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-portal/dist/index.mjs
  var React21 = __toESM(require_react(), 1);
  var import_react_dom2 = __toESM(require_react_dom(), 1);
  var PORTAL_NAME = "Portal";
  var Portal = React21.forwardRef((props, forwardedRef) => {
    const { container: containerProp, ...portalProps } = props;
    const [mounted, setMounted] = React21.useState(false);
    useLayoutEffect2(() => setMounted(true), []);
    const container = containerProp || mounted && globalThis?.document?.body;
    return container ? import_react_dom2.default.createPortal(/* @__PURE__ */ jsx(Primitive.div, { ...portalProps, ref: forwardedRef }), container) : null;
  });
  Portal.displayName = PORTAL_NAME;

  // ../../node_modules/.pnpm/@radix-ui+react-use-controllable-state@1.1.0_@types+react@18.3.12_react@19.2.1/node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
  var React22 = __toESM(require_react(), 1);
  function useControllableState({
    prop,
    defaultProp,
    onChange = () => {
    }
  }) {
    const [uncontrolledProp, setUncontrolledProp] = useUncontrolledState({ defaultProp, onChange });
    const isControlled = prop !== void 0;
    const value = isControlled ? prop : uncontrolledProp;
    const handleChange = useCallbackRef(onChange);
    const setValue = React22.useCallback(
      (nextValue) => {
        if (isControlled) {
          const setter = nextValue;
          const value2 = typeof nextValue === "function" ? setter(prop) : nextValue;
          if (value2 !== prop) handleChange(value2);
        } else {
          setUncontrolledProp(nextValue);
        }
      },
      [isControlled, prop, setUncontrolledProp, handleChange]
    );
    return [value, setValue];
  }
  function useUncontrolledState({
    defaultProp,
    onChange
  }) {
    const uncontrolledState = React22.useState(defaultProp);
    const [value] = uncontrolledState;
    const prevValueRef = React22.useRef(value);
    const handleChange = useCallbackRef(onChange);
    React22.useEffect(() => {
      if (prevValueRef.current !== value) {
        handleChange(value);
        prevValueRef.current = value;
      }
    }, [value, prevValueRef, handleChange]);
    return uncontrolledState;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-visually-hidden@1.1.0_@types+react-dom@18.3.1_@types+react@18.3.12_reac_5bb0983b1979feb277f3f775d43a4c59/node_modules/@radix-ui/react-visually-hidden/dist/index.mjs
  var React23 = __toESM(require_react(), 1);
  var NAME2 = "VisuallyHidden";
  var VisuallyHidden = React23.forwardRef(
    (props, forwardedRef) => {
      return /* @__PURE__ */ jsx(
        Primitive.span,
        {
          ...props,
          ref: forwardedRef,
          style: {
            // See: https://github.com/twbs/bootstrap/blob/master/scss/mixins/_screen-reader.scss
            position: "absolute",
            border: 0,
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            wordWrap: "normal",
            ...props.style
          }
        }
      );
    }
  );
  VisuallyHidden.displayName = NAME2;
  var Root3 = VisuallyHidden;

  // ../../node_modules/.pnpm/aria-hidden@1.2.4/node_modules/aria-hidden/dist/es2015/index.js
  var getDefaultParent = function(originalTarget) {
    if (typeof document === "undefined") {
      return null;
    }
    var sampleTarget = Array.isArray(originalTarget) ? originalTarget[0] : originalTarget;
    return sampleTarget.ownerDocument.body;
  };
  var counterMap = /* @__PURE__ */ new WeakMap();
  var uncontrolledNodes = /* @__PURE__ */ new WeakMap();
  var markerMap = {};
  var lockCount = 0;
  var unwrapHost = function(node) {
    return node && (node.host || unwrapHost(node.parentNode));
  };
  var correctTargets = function(parent, targets) {
    return targets.map(function(target) {
      if (parent.contains(target)) {
        return target;
      }
      var correctedTarget = unwrapHost(target);
      if (correctedTarget && parent.contains(correctedTarget)) {
        return correctedTarget;
      }
      console.error("aria-hidden", target, "in not contained inside", parent, ". Doing nothing");
      return null;
    }).filter(function(x) {
      return Boolean(x);
    });
  };
  var applyAttributeToOthers = function(originalTarget, parentNode, markerName, controlAttribute) {
    var targets = correctTargets(parentNode, Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
    if (!markerMap[markerName]) {
      markerMap[markerName] = /* @__PURE__ */ new WeakMap();
    }
    var markerCounter = markerMap[markerName];
    var hiddenNodes = [];
    var elementsToKeep = /* @__PURE__ */ new Set();
    var elementsToStop = new Set(targets);
    var keep = function(el) {
      if (!el || elementsToKeep.has(el)) {
        return;
      }
      elementsToKeep.add(el);
      keep(el.parentNode);
    };
    targets.forEach(keep);
    var deep = function(parent) {
      if (!parent || elementsToStop.has(parent)) {
        return;
      }
      Array.prototype.forEach.call(parent.children, function(node) {
        if (elementsToKeep.has(node)) {
          deep(node);
        } else {
          try {
            var attr = node.getAttribute(controlAttribute);
            var alreadyHidden = attr !== null && attr !== "false";
            var counterValue = (counterMap.get(node) || 0) + 1;
            var markerValue = (markerCounter.get(node) || 0) + 1;
            counterMap.set(node, counterValue);
            markerCounter.set(node, markerValue);
            hiddenNodes.push(node);
            if (counterValue === 1 && alreadyHidden) {
              uncontrolledNodes.set(node, true);
            }
            if (markerValue === 1) {
              node.setAttribute(markerName, "true");
            }
            if (!alreadyHidden) {
              node.setAttribute(controlAttribute, "true");
            }
          } catch (e15) {
            console.error("aria-hidden: cannot operate on ", node, e15);
          }
        }
      });
    };
    deep(parentNode);
    elementsToKeep.clear();
    lockCount++;
    return function() {
      hiddenNodes.forEach(function(node) {
        var counterValue = counterMap.get(node) - 1;
        var markerValue = markerCounter.get(node) - 1;
        counterMap.set(node, counterValue);
        markerCounter.set(node, markerValue);
        if (!counterValue) {
          if (!uncontrolledNodes.has(node)) {
            node.removeAttribute(controlAttribute);
          }
          uncontrolledNodes.delete(node);
        }
        if (!markerValue) {
          node.removeAttribute(markerName);
        }
      });
      lockCount--;
      if (!lockCount) {
        counterMap = /* @__PURE__ */ new WeakMap();
        counterMap = /* @__PURE__ */ new WeakMap();
        uncontrolledNodes = /* @__PURE__ */ new WeakMap();
        markerMap = {};
      }
    };
  };
  var hideOthers = function(originalTarget, parentNode, markerName) {
    if (markerName === void 0) {
      markerName = "data-aria-hidden";
    }
    var targets = Array.from(Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
    var activeParentNode = parentNode || getDefaultParent(originalTarget);
    if (!activeParentNode) {
      return function() {
        return null;
      };
    }
    targets.push.apply(targets, Array.from(activeParentNode.querySelectorAll("[aria-live]")));
    return applyAttributeToOthers(targets, activeParentNode, markerName, "aria-hidden");
  };

  // ../../node_modules/.pnpm/tslib@2.8.1/node_modules/tslib/tslib.es6.mjs
  var __assign = function() {
    __assign = Object.assign || function __assign2(t) {
      for (var s4, i = 1, n3 = arguments.length; i < n3; i++) {
        s4 = arguments[i];
        for (var p2 in s4) if (Object.prototype.hasOwnProperty.call(s4, p2)) t[p2] = s4[p2];
      }
      return t;
    };
    return __assign.apply(this, arguments);
  };
  function __rest(s4, e15) {
    var t = {};
    for (var p2 in s4) if (Object.prototype.hasOwnProperty.call(s4, p2) && e15.indexOf(p2) < 0)
      t[p2] = s4[p2];
    if (s4 != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, p2 = Object.getOwnPropertySymbols(s4); i < p2.length; i++) {
        if (e15.indexOf(p2[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s4, p2[i]))
          t[p2[i]] = s4[p2[i]];
      }
    return t;
  }
  function __spreadArray(to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
      if (ar || !(i in from)) {
        if (!ar) ar = Array.prototype.slice.call(from, 0, i);
        ar[i] = from[i];
      }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
  }

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/Combination.js
  var React30 = __toESM(require_react());

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/UI.js
  var React26 = __toESM(require_react());

  // ../../node_modules/.pnpm/react-remove-scroll-bar@2.3.8_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll-bar/dist/es2015/constants.js
  var zeroRightClassName = "right-scroll-bar-position";
  var fullWidthClassName = "width-before-scroll-bar";
  var noScrollbarsClassName = "with-scroll-bars-hidden";
  var removedBarSizeVariable = "--removed-body-scroll-bar-size";

  // ../../node_modules/.pnpm/use-callback-ref@1.3.3_@types+react@18.3.12_react@19.2.1/node_modules/use-callback-ref/dist/es2015/assignRef.js
  function assignRef(ref, value) {
    if (typeof ref === "function") {
      ref(value);
    } else if (ref) {
      ref.current = value;
    }
    return ref;
  }

  // ../../node_modules/.pnpm/use-callback-ref@1.3.3_@types+react@18.3.12_react@19.2.1/node_modules/use-callback-ref/dist/es2015/useRef.js
  var import_react9 = __toESM(require_react());
  function useCallbackRef2(initialValue, callback) {
    var ref = (0, import_react9.useState)(function() {
      return {
        // value
        value: initialValue,
        // last callback
        callback,
        // "memoized" public interface
        facade: {
          get current() {
            return ref.value;
          },
          set current(value) {
            var last = ref.value;
            if (last !== value) {
              ref.value = value;
              ref.callback(value, last);
            }
          }
        }
      };
    })[0];
    ref.callback = callback;
    return ref.facade;
  }

  // ../../node_modules/.pnpm/use-callback-ref@1.3.3_@types+react@18.3.12_react@19.2.1/node_modules/use-callback-ref/dist/es2015/useMergeRef.js
  var React24 = __toESM(require_react());
  var useIsomorphicLayoutEffect = typeof window !== "undefined" ? React24.useLayoutEffect : React24.useEffect;
  var currentValues = /* @__PURE__ */ new WeakMap();
  function useMergeRefs(refs, defaultValue2) {
    var callbackRef = useCallbackRef2(defaultValue2 || null, function(newValue) {
      return refs.forEach(function(ref) {
        return assignRef(ref, newValue);
      });
    });
    useIsomorphicLayoutEffect(function() {
      var oldValue = currentValues.get(callbackRef);
      if (oldValue) {
        var prevRefs_1 = new Set(oldValue);
        var nextRefs_1 = new Set(refs);
        var current_1 = callbackRef.current;
        prevRefs_1.forEach(function(ref) {
          if (!nextRefs_1.has(ref)) {
            assignRef(ref, null);
          }
        });
        nextRefs_1.forEach(function(ref) {
          if (!prevRefs_1.has(ref)) {
            assignRef(ref, current_1);
          }
        });
      }
      currentValues.set(callbackRef, refs);
    }, [refs]);
    return callbackRef;
  }

  // ../../node_modules/.pnpm/use-sidecar@1.1.3_@types+react@18.3.12_react@19.2.1/node_modules/use-sidecar/dist/es2015/medium.js
  function ItoI(a8) {
    return a8;
  }
  function innerCreateMedium(defaults, middleware) {
    if (middleware === void 0) {
      middleware = ItoI;
    }
    var buffer = [];
    var assigned = false;
    var medium = {
      read: function() {
        if (assigned) {
          throw new Error("Sidecar: could not `read` from an `assigned` medium. `read` could be used only with `useMedium`.");
        }
        if (buffer.length) {
          return buffer[buffer.length - 1];
        }
        return defaults;
      },
      useMedium: function(data) {
        var item = middleware(data, assigned);
        buffer.push(item);
        return function() {
          buffer = buffer.filter(function(x) {
            return x !== item;
          });
        };
      },
      assignSyncMedium: function(cb) {
        assigned = true;
        while (buffer.length) {
          var cbs = buffer;
          buffer = [];
          cbs.forEach(cb);
        }
        buffer = {
          push: function(x) {
            return cb(x);
          },
          filter: function() {
            return buffer;
          }
        };
      },
      assignMedium: function(cb) {
        assigned = true;
        var pendingQueue = [];
        if (buffer.length) {
          var cbs = buffer;
          buffer = [];
          cbs.forEach(cb);
          pendingQueue = buffer;
        }
        var executeQueue = function() {
          var cbs2 = pendingQueue;
          pendingQueue = [];
          cbs2.forEach(cb);
        };
        var cycle = function() {
          return Promise.resolve().then(executeQueue);
        };
        cycle();
        buffer = {
          push: function(x) {
            pendingQueue.push(x);
            cycle();
          },
          filter: function(filter) {
            pendingQueue = pendingQueue.filter(filter);
            return buffer;
          }
        };
      }
    };
    return medium;
  }
  function createSidecarMedium(options) {
    if (options === void 0) {
      options = {};
    }
    var medium = innerCreateMedium(null);
    medium.options = __assign({ async: true, ssr: false }, options);
    return medium;
  }

  // ../../node_modules/.pnpm/use-sidecar@1.1.3_@types+react@18.3.12_react@19.2.1/node_modules/use-sidecar/dist/es2015/exports.js
  var React25 = __toESM(require_react());
  var SideCar = function(_a5) {
    var sideCar = _a5.sideCar, rest = __rest(_a5, ["sideCar"]);
    if (!sideCar) {
      throw new Error("Sidecar: please provide `sideCar` property to import the right car");
    }
    var Target = sideCar.read();
    if (!Target) {
      throw new Error("Sidecar medium not found");
    }
    return React25.createElement(Target, __assign({}, rest));
  };
  SideCar.isSideCarExport = true;
  function exportSidecar(medium, exported) {
    medium.useMedium(exported);
    return SideCar;
  }

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/medium.js
  var effectCar = createSidecarMedium();

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/UI.js
  var nothing = function() {
    return;
  };
  var RemoveScroll = React26.forwardRef(function(props, parentRef) {
    var ref = React26.useRef(null);
    var _a5 = React26.useState({
      onScrollCapture: nothing,
      onWheelCapture: nothing,
      onTouchMoveCapture: nothing
    }), callbacks = _a5[0], setCallbacks = _a5[1];
    var forwardProps = props.forwardProps, children = props.children, className = props.className, removeScrollBar = props.removeScrollBar, enabled = props.enabled, shards = props.shards, sideCar = props.sideCar, noIsolation = props.noIsolation, inert = props.inert, allowPinchZoom = props.allowPinchZoom, _b = props.as, Container = _b === void 0 ? "div" : _b, gapMode = props.gapMode, rest = __rest(props, ["forwardProps", "children", "className", "removeScrollBar", "enabled", "shards", "sideCar", "noIsolation", "inert", "allowPinchZoom", "as", "gapMode"]);
    var SideCar2 = sideCar;
    var containerRef = useMergeRefs([ref, parentRef]);
    var containerProps = __assign(__assign({}, rest), callbacks);
    return React26.createElement(
      React26.Fragment,
      null,
      enabled && React26.createElement(SideCar2, { sideCar: effectCar, removeScrollBar, shards, noIsolation, inert, setCallbacks, allowPinchZoom: !!allowPinchZoom, lockRef: ref, gapMode }),
      forwardProps ? React26.cloneElement(React26.Children.only(children), __assign(__assign({}, containerProps), { ref: containerRef })) : React26.createElement(Container, __assign({}, containerProps, { className, ref: containerRef }), children)
    );
  });
  RemoveScroll.defaultProps = {
    enabled: true,
    removeScrollBar: true,
    inert: false
  };
  RemoveScroll.classNames = {
    fullWidth: fullWidthClassName,
    zeroRight: zeroRightClassName
  };

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/SideEffect.js
  var React29 = __toESM(require_react());

  // ../../node_modules/.pnpm/react-remove-scroll-bar@2.3.8_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll-bar/dist/es2015/component.js
  var React28 = __toESM(require_react());

  // ../../node_modules/.pnpm/react-style-singleton@2.2.3_@types+react@18.3.12_react@19.2.1/node_modules/react-style-singleton/dist/es2015/hook.js
  var React27 = __toESM(require_react());

  // ../../node_modules/.pnpm/get-nonce@1.0.1/node_modules/get-nonce/dist/es2015/index.js
  var currentNonce;
  var getNonce = function() {
    if (currentNonce) {
      return currentNonce;
    }
    if (typeof __webpack_nonce__ !== "undefined") {
      return __webpack_nonce__;
    }
    return void 0;
  };

  // ../../node_modules/.pnpm/react-style-singleton@2.2.3_@types+react@18.3.12_react@19.2.1/node_modules/react-style-singleton/dist/es2015/singleton.js
  function makeStyleTag() {
    if (!document)
      return null;
    var tag = document.createElement("style");
    tag.type = "text/css";
    var nonce = getNonce();
    if (nonce) {
      tag.setAttribute("nonce", nonce);
    }
    return tag;
  }
  function injectStyles(tag, css) {
    if (tag.styleSheet) {
      tag.styleSheet.cssText = css;
    } else {
      tag.appendChild(document.createTextNode(css));
    }
  }
  function insertStyleTag(tag) {
    var head = document.head || document.getElementsByTagName("head")[0];
    head.appendChild(tag);
  }
  var stylesheetSingleton = function() {
    var counter = 0;
    var stylesheet = null;
    return {
      add: function(style) {
        if (counter == 0) {
          if (stylesheet = makeStyleTag()) {
            injectStyles(stylesheet, style);
            insertStyleTag(stylesheet);
          }
        }
        counter++;
      },
      remove: function() {
        counter--;
        if (!counter && stylesheet) {
          stylesheet.parentNode && stylesheet.parentNode.removeChild(stylesheet);
          stylesheet = null;
        }
      }
    };
  };

  // ../../node_modules/.pnpm/react-style-singleton@2.2.3_@types+react@18.3.12_react@19.2.1/node_modules/react-style-singleton/dist/es2015/hook.js
  var styleHookSingleton = function() {
    var sheet = stylesheetSingleton();
    return function(styles, isDynamic) {
      React27.useEffect(function() {
        sheet.add(styles);
        return function() {
          sheet.remove();
        };
      }, [styles && isDynamic]);
    };
  };

  // ../../node_modules/.pnpm/react-style-singleton@2.2.3_@types+react@18.3.12_react@19.2.1/node_modules/react-style-singleton/dist/es2015/component.js
  var styleSingleton = function() {
    var useStyle = styleHookSingleton();
    var Sheet = function(_a5) {
      var styles = _a5.styles, dynamic = _a5.dynamic;
      useStyle(styles, dynamic);
      return null;
    };
    return Sheet;
  };

  // ../../node_modules/.pnpm/react-remove-scroll-bar@2.3.8_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll-bar/dist/es2015/utils.js
  var zeroGap = {
    left: 0,
    top: 0,
    right: 0,
    gap: 0
  };
  var parse = function(x) {
    return parseInt(x || "", 10) || 0;
  };
  var getOffset = function(gapMode) {
    var cs = window.getComputedStyle(document.body);
    var left = cs[gapMode === "padding" ? "paddingLeft" : "marginLeft"];
    var top = cs[gapMode === "padding" ? "paddingTop" : "marginTop"];
    var right = cs[gapMode === "padding" ? "paddingRight" : "marginRight"];
    return [parse(left), parse(top), parse(right)];
  };
  var getGapWidth = function(gapMode) {
    if (gapMode === void 0) {
      gapMode = "margin";
    }
    if (typeof window === "undefined") {
      return zeroGap;
    }
    var offsets = getOffset(gapMode);
    var documentWidth = document.documentElement.clientWidth;
    var windowWidth = window.innerWidth;
    return {
      left: offsets[0],
      top: offsets[1],
      right: offsets[2],
      gap: Math.max(0, windowWidth - documentWidth + offsets[2] - offsets[0])
    };
  };

  // ../../node_modules/.pnpm/react-remove-scroll-bar@2.3.8_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll-bar/dist/es2015/component.js
  var Style = styleSingleton();
  var lockAttribute = "data-scroll-locked";
  var getStyles = function(_a5, allowRelative, gapMode, important) {
    var left = _a5.left, top = _a5.top, right = _a5.right, gap = _a5.gap;
    if (gapMode === void 0) {
      gapMode = "margin";
    }
    return "\n  .".concat(noScrollbarsClassName, " {\n   overflow: hidden ").concat(important, ";\n   padding-right: ").concat(gap, "px ").concat(important, ";\n  }\n  body[").concat(lockAttribute, "] {\n    overflow: hidden ").concat(important, ";\n    overscroll-behavior: contain;\n    ").concat([
      allowRelative && "position: relative ".concat(important, ";"),
      gapMode === "margin" && "\n    padding-left: ".concat(left, "px;\n    padding-top: ").concat(top, "px;\n    padding-right: ").concat(right, "px;\n    margin-left:0;\n    margin-top:0;\n    margin-right: ").concat(gap, "px ").concat(important, ";\n    "),
      gapMode === "padding" && "padding-right: ".concat(gap, "px ").concat(important, ";")
    ].filter(Boolean).join(""), "\n  }\n  \n  .").concat(zeroRightClassName, " {\n    right: ").concat(gap, "px ").concat(important, ";\n  }\n  \n  .").concat(fullWidthClassName, " {\n    margin-right: ").concat(gap, "px ").concat(important, ";\n  }\n  \n  .").concat(zeroRightClassName, " .").concat(zeroRightClassName, " {\n    right: 0 ").concat(important, ";\n  }\n  \n  .").concat(fullWidthClassName, " .").concat(fullWidthClassName, " {\n    margin-right: 0 ").concat(important, ";\n  }\n  \n  body[").concat(lockAttribute, "] {\n    ").concat(removedBarSizeVariable, ": ").concat(gap, "px;\n  }\n");
  };
  var getCurrentUseCounter = function() {
    var counter = parseInt(document.body.getAttribute(lockAttribute) || "0", 10);
    return isFinite(counter) ? counter : 0;
  };
  var useLockAttribute = function() {
    React28.useEffect(function() {
      document.body.setAttribute(lockAttribute, (getCurrentUseCounter() + 1).toString());
      return function() {
        var newCounter = getCurrentUseCounter() - 1;
        if (newCounter <= 0) {
          document.body.removeAttribute(lockAttribute);
        } else {
          document.body.setAttribute(lockAttribute, newCounter.toString());
        }
      };
    }, []);
  };
  var RemoveScrollBar = function(_a5) {
    var noRelative = _a5.noRelative, noImportant = _a5.noImportant, _b = _a5.gapMode, gapMode = _b === void 0 ? "margin" : _b;
    useLockAttribute();
    var gap = React28.useMemo(function() {
      return getGapWidth(gapMode);
    }, [gapMode]);
    return React28.createElement(Style, { styles: getStyles(gap, !noRelative, gapMode, !noImportant ? "!important" : "") });
  };

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/aggresiveCapture.js
  var passiveSupported = false;
  if (typeof window !== "undefined") {
    try {
      options = Object.defineProperty({}, "passive", {
        get: function() {
          passiveSupported = true;
          return true;
        }
      });
      window.addEventListener("test", options, options);
      window.removeEventListener("test", options, options);
    } catch (err) {
      passiveSupported = false;
    }
  }
  var options;
  var nonPassive = passiveSupported ? { passive: false } : false;

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/handleScroll.js
  var alwaysContainsScroll = function(node) {
    return node.tagName === "TEXTAREA";
  };
  var elementCanBeScrolled = function(node, overflow) {
    if (!(node instanceof Element)) {
      return false;
    }
    var styles = window.getComputedStyle(node);
    return (
      // not-not-scrollable
      styles[overflow] !== "hidden" && // contains scroll inside self
      !(styles.overflowY === styles.overflowX && !alwaysContainsScroll(node) && styles[overflow] === "visible")
    );
  };
  var elementCouldBeVScrolled = function(node) {
    return elementCanBeScrolled(node, "overflowY");
  };
  var elementCouldBeHScrolled = function(node) {
    return elementCanBeScrolled(node, "overflowX");
  };
  var locationCouldBeScrolled = function(axis, node) {
    var ownerDocument = node.ownerDocument;
    var current = node;
    do {
      if (typeof ShadowRoot !== "undefined" && current instanceof ShadowRoot) {
        current = current.host;
      }
      var isScrollable2 = elementCouldBeScrolled(axis, current);
      if (isScrollable2) {
        var _a5 = getScrollVariables(axis, current), scrollHeight = _a5[1], clientHeight = _a5[2];
        if (scrollHeight > clientHeight) {
          return true;
        }
      }
      current = current.parentNode;
    } while (current && current !== ownerDocument.body);
    return false;
  };
  var getVScrollVariables = function(_a5) {
    var scrollTop = _a5.scrollTop, scrollHeight = _a5.scrollHeight, clientHeight = _a5.clientHeight;
    return [
      scrollTop,
      scrollHeight,
      clientHeight
    ];
  };
  var getHScrollVariables = function(_a5) {
    var scrollLeft = _a5.scrollLeft, scrollWidth = _a5.scrollWidth, clientWidth = _a5.clientWidth;
    return [
      scrollLeft,
      scrollWidth,
      clientWidth
    ];
  };
  var elementCouldBeScrolled = function(axis, node) {
    return axis === "v" ? elementCouldBeVScrolled(node) : elementCouldBeHScrolled(node);
  };
  var getScrollVariables = function(axis, node) {
    return axis === "v" ? getVScrollVariables(node) : getHScrollVariables(node);
  };
  var getDirectionFactor = function(axis, direction) {
    return axis === "h" && direction === "rtl" ? -1 : 1;
  };
  var handleScroll = function(axis, endTarget, event, sourceDelta, noOverscroll) {
    var directionFactor = getDirectionFactor(axis, window.getComputedStyle(endTarget).direction);
    var delta = directionFactor * sourceDelta;
    var target = event.target;
    var targetInLock = endTarget.contains(target);
    var shouldCancelScroll = false;
    var isDeltaPositive = delta > 0;
    var availableScroll = 0;
    var availableScrollTop = 0;
    do {
      var _a5 = getScrollVariables(axis, target), position = _a5[0], scroll_1 = _a5[1], capacity = _a5[2];
      var elementScroll = scroll_1 - capacity - directionFactor * position;
      if (position || elementScroll) {
        if (elementCouldBeScrolled(axis, target)) {
          availableScroll += elementScroll;
          availableScrollTop += position;
        }
      }
      if (target instanceof ShadowRoot) {
        target = target.host;
      } else {
        target = target.parentNode;
      }
    } while (
      // portaled content
      !targetInLock && target !== document.body || // self content
      targetInLock && (endTarget.contains(target) || endTarget === target)
    );
    if (isDeltaPositive && (noOverscroll && Math.abs(availableScroll) < 1 || !noOverscroll && delta > availableScroll)) {
      shouldCancelScroll = true;
    } else if (!isDeltaPositive && (noOverscroll && Math.abs(availableScrollTop) < 1 || !noOverscroll && -delta > availableScrollTop)) {
      shouldCancelScroll = true;
    }
    return shouldCancelScroll;
  };

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/SideEffect.js
  var getTouchXY = function(event) {
    return "changedTouches" in event ? [event.changedTouches[0].clientX, event.changedTouches[0].clientY] : [0, 0];
  };
  var getDeltaXY = function(event) {
    return [event.deltaX, event.deltaY];
  };
  var extractRef = function(ref) {
    return ref && "current" in ref ? ref.current : ref;
  };
  var deltaCompare = function(x, y) {
    return x[0] === y[0] && x[1] === y[1];
  };
  var generateStyle = function(id) {
    return "\n  .block-interactivity-".concat(id, " {pointer-events: none;}\n  .allow-interactivity-").concat(id, " {pointer-events: all;}\n");
  };
  var idCounter = 0;
  var lockStack = [];
  function RemoveScrollSideCar(props) {
    var shouldPreventQueue = React29.useRef([]);
    var touchStartRef = React29.useRef([0, 0]);
    var activeAxis = React29.useRef();
    var id = React29.useState(idCounter++)[0];
    var Style2 = React29.useState(styleSingleton)[0];
    var lastProps = React29.useRef(props);
    React29.useEffect(function() {
      lastProps.current = props;
    }, [props]);
    React29.useEffect(function() {
      if (props.inert) {
        document.body.classList.add("block-interactivity-".concat(id));
        var allow_1 = __spreadArray([props.lockRef.current], (props.shards || []).map(extractRef), true).filter(Boolean);
        allow_1.forEach(function(el) {
          return el.classList.add("allow-interactivity-".concat(id));
        });
        return function() {
          document.body.classList.remove("block-interactivity-".concat(id));
          allow_1.forEach(function(el) {
            return el.classList.remove("allow-interactivity-".concat(id));
          });
        };
      }
      return;
    }, [props.inert, props.lockRef.current, props.shards]);
    var shouldCancelEvent = React29.useCallback(function(event, parent) {
      if ("touches" in event && event.touches.length === 2 || event.type === "wheel" && event.ctrlKey) {
        return !lastProps.current.allowPinchZoom;
      }
      var touch = getTouchXY(event);
      var touchStart = touchStartRef.current;
      var deltaX = "deltaX" in event ? event.deltaX : touchStart[0] - touch[0];
      var deltaY = "deltaY" in event ? event.deltaY : touchStart[1] - touch[1];
      var currentAxis;
      var target = event.target;
      var moveDirection = Math.abs(deltaX) > Math.abs(deltaY) ? "h" : "v";
      if ("touches" in event && moveDirection === "h" && target.type === "range") {
        return false;
      }
      var canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);
      if (!canBeScrolledInMainDirection) {
        return true;
      }
      if (canBeScrolledInMainDirection) {
        currentAxis = moveDirection;
      } else {
        currentAxis = moveDirection === "v" ? "h" : "v";
        canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);
      }
      if (!canBeScrolledInMainDirection) {
        return false;
      }
      if (!activeAxis.current && "changedTouches" in event && (deltaX || deltaY)) {
        activeAxis.current = currentAxis;
      }
      if (!currentAxis) {
        return true;
      }
      var cancelingAxis = activeAxis.current || currentAxis;
      return handleScroll(cancelingAxis, parent, event, cancelingAxis === "h" ? deltaX : deltaY, true);
    }, []);
    var shouldPrevent = React29.useCallback(function(_event) {
      var event = _event;
      if (!lockStack.length || lockStack[lockStack.length - 1] !== Style2) {
        return;
      }
      var delta = "deltaY" in event ? getDeltaXY(event) : getTouchXY(event);
      var sourceEvent = shouldPreventQueue.current.filter(function(e15) {
        return e15.name === event.type && (e15.target === event.target || event.target === e15.shadowParent) && deltaCompare(e15.delta, delta);
      })[0];
      if (sourceEvent && sourceEvent.should) {
        if (event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      if (!sourceEvent) {
        var shardNodes = (lastProps.current.shards || []).map(extractRef).filter(Boolean).filter(function(node) {
          return node.contains(event.target);
        });
        var shouldStop = shardNodes.length > 0 ? shouldCancelEvent(event, shardNodes[0]) : !lastProps.current.noIsolation;
        if (shouldStop) {
          if (event.cancelable) {
            event.preventDefault();
          }
        }
      }
    }, []);
    var shouldCancel = React29.useCallback(function(name, delta, target, should) {
      var event = { name, delta, target, should, shadowParent: getOutermostShadowParent(target) };
      shouldPreventQueue.current.push(event);
      setTimeout(function() {
        shouldPreventQueue.current = shouldPreventQueue.current.filter(function(e15) {
          return e15 !== event;
        });
      }, 1);
    }, []);
    var scrollTouchStart = React29.useCallback(function(event) {
      touchStartRef.current = getTouchXY(event);
      activeAxis.current = void 0;
    }, []);
    var scrollWheel = React29.useCallback(function(event) {
      shouldCancel(event.type, getDeltaXY(event), event.target, shouldCancelEvent(event, props.lockRef.current));
    }, []);
    var scrollTouchMove = React29.useCallback(function(event) {
      shouldCancel(event.type, getTouchXY(event), event.target, shouldCancelEvent(event, props.lockRef.current));
    }, []);
    React29.useEffect(function() {
      lockStack.push(Style2);
      props.setCallbacks({
        onScrollCapture: scrollWheel,
        onWheelCapture: scrollWheel,
        onTouchMoveCapture: scrollTouchMove
      });
      document.addEventListener("wheel", shouldPrevent, nonPassive);
      document.addEventListener("touchmove", shouldPrevent, nonPassive);
      document.addEventListener("touchstart", scrollTouchStart, nonPassive);
      return function() {
        lockStack = lockStack.filter(function(inst) {
          return inst !== Style2;
        });
        document.removeEventListener("wheel", shouldPrevent, nonPassive);
        document.removeEventListener("touchmove", shouldPrevent, nonPassive);
        document.removeEventListener("touchstart", scrollTouchStart, nonPassive);
      };
    }, []);
    var removeScrollBar = props.removeScrollBar, inert = props.inert;
    return React29.createElement(
      React29.Fragment,
      null,
      inert ? React29.createElement(Style2, { styles: generateStyle(id) }) : null,
      removeScrollBar ? React29.createElement(RemoveScrollBar, { gapMode: props.gapMode }) : null
    );
  }
  function getOutermostShadowParent(node) {
    var shadowParent = null;
    while (node !== null) {
      if (node instanceof ShadowRoot) {
        shadowParent = node.host;
        node = node.host;
      }
      node = node.parentNode;
    }
    return shadowParent;
  }

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/sidecar.js
  var sidecar_default = exportSidecar(effectCar, RemoveScrollSideCar);

  // ../../node_modules/.pnpm/react-remove-scroll@2.6.0_@types+react@18.3.12_react@19.2.1/node_modules/react-remove-scroll/dist/es2015/Combination.js
  var ReactRemoveScroll = React30.forwardRef(function(props, ref) {
    return React30.createElement(RemoveScroll, __assign({}, props, { ref, sideCar: sidecar_default }));
  });
  ReactRemoveScroll.classNames = RemoveScroll.classNames;
  var Combination_default = ReactRemoveScroll;

  // ../../node_modules/.pnpm/@radix-ui+react-presence@1.1.1_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-presence/dist/index.mjs
  var React210 = __toESM(require_react(), 1);
  var React31 = __toESM(require_react(), 1);
  function useStateMachine(initialState, machine) {
    return React31.useReducer((state, event) => {
      const nextState = machine[state][event];
      return nextState ?? state;
    }, initialState);
  }
  var Presence = (props) => {
    const { present, children } = props;
    const presence = usePresence(present);
    const child = typeof children === "function" ? children({ present: presence.isPresent }) : React210.Children.only(children);
    const ref = useComposedRefs(presence.ref, getElementRef2(child));
    const forceMount = typeof children === "function";
    return forceMount || presence.isPresent ? React210.cloneElement(child, { ref }) : null;
  };
  Presence.displayName = "Presence";
  function usePresence(present) {
    const [node, setNode] = React210.useState();
    const stylesRef = React210.useRef({});
    const prevPresentRef = React210.useRef(present);
    const prevAnimationNameRef = React210.useRef("none");
    const initialState = present ? "mounted" : "unmounted";
    const [state, send] = useStateMachine(initialState, {
      mounted: {
        UNMOUNT: "unmounted",
        ANIMATION_OUT: "unmountSuspended"
      },
      unmountSuspended: {
        MOUNT: "mounted",
        ANIMATION_END: "unmounted"
      },
      unmounted: {
        MOUNT: "mounted"
      }
    });
    React210.useEffect(() => {
      const currentAnimationName = getAnimationName(stylesRef.current);
      prevAnimationNameRef.current = state === "mounted" ? currentAnimationName : "none";
    }, [state]);
    useLayoutEffect2(() => {
      const styles = stylesRef.current;
      const wasPresent = prevPresentRef.current;
      const hasPresentChanged = wasPresent !== present;
      if (hasPresentChanged) {
        const prevAnimationName = prevAnimationNameRef.current;
        const currentAnimationName = getAnimationName(styles);
        if (present) {
          send("MOUNT");
        } else if (currentAnimationName === "none" || styles?.display === "none") {
          send("UNMOUNT");
        } else {
          const isAnimating = prevAnimationName !== currentAnimationName;
          if (wasPresent && isAnimating) {
            send("ANIMATION_OUT");
          } else {
            send("UNMOUNT");
          }
        }
        prevPresentRef.current = present;
      }
    }, [present, send]);
    useLayoutEffect2(() => {
      if (node) {
        let timeoutId;
        const ownerWindow = node.ownerDocument.defaultView ?? window;
        const handleAnimationEnd = (event) => {
          const currentAnimationName = getAnimationName(stylesRef.current);
          const isCurrentAnimation = currentAnimationName.includes(event.animationName);
          if (event.target === node && isCurrentAnimation) {
            send("ANIMATION_END");
            if (!prevPresentRef.current) {
              const currentFillMode = node.style.animationFillMode;
              node.style.animationFillMode = "forwards";
              timeoutId = ownerWindow.setTimeout(() => {
                if (node.style.animationFillMode === "forwards") {
                  node.style.animationFillMode = currentFillMode;
                }
              });
            }
          }
        };
        const handleAnimationStart = (event) => {
          if (event.target === node) {
            prevAnimationNameRef.current = getAnimationName(stylesRef.current);
          }
        };
        node.addEventListener("animationstart", handleAnimationStart);
        node.addEventListener("animationcancel", handleAnimationEnd);
        node.addEventListener("animationend", handleAnimationEnd);
        return () => {
          ownerWindow.clearTimeout(timeoutId);
          node.removeEventListener("animationstart", handleAnimationStart);
          node.removeEventListener("animationcancel", handleAnimationEnd);
          node.removeEventListener("animationend", handleAnimationEnd);
        };
      } else {
        send("ANIMATION_END");
      }
    }, [node, send]);
    return {
      isPresent: ["mounted", "unmountSuspended"].includes(state),
      ref: React210.useCallback((node2) => {
        if (node2) stylesRef.current = getComputedStyle(node2);
        setNode(node2);
      }, [])
    };
  }
  function getAnimationName(styles) {
    return styles?.animationName || "none";
  }
  function getElementRef2(element) {
    let getter2 = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
    let mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.ref;
    }
    getter2 = Object.getOwnPropertyDescriptor(element, "ref")?.get;
    mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.props.ref;
    }
    return element.props.ref || element.ref;
  }

  // ../../node_modules/.pnpm/@radix-ui+primitive@1.1.3/node_modules/@radix-ui/primitive/dist/index.mjs
  var canUseDOM = !!(typeof window !== "undefined" && window.document && window.document.createElement);
  function composeEventHandlers2(originalEventHandler, ourEventHandler, { checkForDefaultPrevented = true } = {}) {
    return function handleEvent(event) {
      originalEventHandler?.(event);
      if (checkForDefaultPrevented === false || !event.defaultPrevented) {
        return ourEventHandler?.(event);
      }
    };
  }

  // ../stack-ui/dist/esm/components/ui/dialog.js
  var import_react10 = __toESM(require_react());

  // ../../node_modules/.pnpm/@radix-ui+react-dialog@1.1.2_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-dialog/dist/index.mjs
  var React32 = __toESM(require_react(), 1);
  var DIALOG_NAME = "Dialog";
  var [createDialogContext, createDialogScope] = createContextScope2(DIALOG_NAME);
  var [DialogProvider, useDialogContext] = createDialogContext(DIALOG_NAME);
  var Dialog = (props) => {
    const {
      __scopeDialog,
      children,
      open: openProp,
      defaultOpen,
      onOpenChange,
      modal = true
    } = props;
    const triggerRef = React32.useRef(null);
    const contentRef = React32.useRef(null);
    const [open = false, setOpen] = useControllableState({
      prop: openProp,
      defaultProp: defaultOpen,
      onChange: onOpenChange
    });
    return /* @__PURE__ */ jsx(
      DialogProvider,
      {
        scope: __scopeDialog,
        triggerRef,
        contentRef,
        contentId: useId(),
        titleId: useId(),
        descriptionId: useId(),
        open,
        onOpenChange: setOpen,
        onOpenToggle: React32.useCallback(() => setOpen((prevOpen) => !prevOpen), [setOpen]),
        modal,
        children
      }
    );
  };
  Dialog.displayName = DIALOG_NAME;
  var TRIGGER_NAME = "DialogTrigger";
  var DialogTrigger = React32.forwardRef(
    (props, forwardedRef) => {
      const { __scopeDialog, ...triggerProps } = props;
      const context = useDialogContext(TRIGGER_NAME, __scopeDialog);
      const composedTriggerRef = useComposedRefs(forwardedRef, context.triggerRef);
      return /* @__PURE__ */ jsx(
        Primitive.button,
        {
          type: "button",
          "aria-haspopup": "dialog",
          "aria-expanded": context.open,
          "aria-controls": context.contentId,
          "data-state": getState(context.open),
          ...triggerProps,
          ref: composedTriggerRef,
          onClick: composeEventHandlers(props.onClick, context.onOpenToggle)
        }
      );
    }
  );
  DialogTrigger.displayName = TRIGGER_NAME;
  var PORTAL_NAME2 = "DialogPortal";
  var [PortalProvider, usePortalContext] = createDialogContext(PORTAL_NAME2, {
    forceMount: void 0
  });
  var DialogPortal = (props) => {
    const { __scopeDialog, forceMount, children, container } = props;
    const context = useDialogContext(PORTAL_NAME2, __scopeDialog);
    return /* @__PURE__ */ jsx(PortalProvider, { scope: __scopeDialog, forceMount, children: React32.Children.map(children, (child) => /* @__PURE__ */ jsx(Presence, { present: forceMount || context.open, children: /* @__PURE__ */ jsx(Portal, { asChild: true, container, children: child }) })) });
  };
  DialogPortal.displayName = PORTAL_NAME2;
  var OVERLAY_NAME = "DialogOverlay";
  var DialogOverlay = React32.forwardRef(
    (props, forwardedRef) => {
      const portalContext = usePortalContext(OVERLAY_NAME, props.__scopeDialog);
      const { forceMount = portalContext.forceMount, ...overlayProps } = props;
      const context = useDialogContext(OVERLAY_NAME, props.__scopeDialog);
      return context.modal ? /* @__PURE__ */ jsx(Presence, { present: forceMount || context.open, children: /* @__PURE__ */ jsx(DialogOverlayImpl, { ...overlayProps, ref: forwardedRef }) }) : null;
    }
  );
  DialogOverlay.displayName = OVERLAY_NAME;
  var DialogOverlayImpl = React32.forwardRef(
    (props, forwardedRef) => {
      const { __scopeDialog, ...overlayProps } = props;
      const context = useDialogContext(OVERLAY_NAME, __scopeDialog);
      return (
        // Make sure `Content` is scrollable even when it doesn't live inside `RemoveScroll`
        // ie. when `Overlay` and `Content` are siblings
        /* @__PURE__ */ jsx(Combination_default, { as: Slot, allowPinchZoom: true, shards: [context.contentRef], children: /* @__PURE__ */ jsx(
          Primitive.div,
          {
            "data-state": getState(context.open),
            ...overlayProps,
            ref: forwardedRef,
            style: { pointerEvents: "auto", ...overlayProps.style }
          }
        ) })
      );
    }
  );
  var CONTENT_NAME2 = "DialogContent";
  var DialogContent = React32.forwardRef(
    (props, forwardedRef) => {
      const portalContext = usePortalContext(CONTENT_NAME2, props.__scopeDialog);
      const { forceMount = portalContext.forceMount, ...contentProps } = props;
      const context = useDialogContext(CONTENT_NAME2, props.__scopeDialog);
      return /* @__PURE__ */ jsx(Presence, { present: forceMount || context.open, children: context.modal ? /* @__PURE__ */ jsx(DialogContentModal, { ...contentProps, ref: forwardedRef }) : /* @__PURE__ */ jsx(DialogContentNonModal, { ...contentProps, ref: forwardedRef }) });
    }
  );
  DialogContent.displayName = CONTENT_NAME2;
  var DialogContentModal = React32.forwardRef(
    (props, forwardedRef) => {
      const context = useDialogContext(CONTENT_NAME2, props.__scopeDialog);
      const contentRef = React32.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, context.contentRef, contentRef);
      React32.useEffect(() => {
        const content = contentRef.current;
        if (content) return hideOthers(content);
      }, []);
      return /* @__PURE__ */ jsx(
        DialogContentImpl,
        {
          ...props,
          ref: composedRefs,
          trapFocus: context.open,
          disableOutsidePointerEvents: true,
          onCloseAutoFocus: composeEventHandlers(props.onCloseAutoFocus, (event) => {
            event.preventDefault();
            context.triggerRef.current?.focus();
          }),
          onPointerDownOutside: composeEventHandlers(props.onPointerDownOutside, (event) => {
            const originalEvent = event.detail.originalEvent;
            const ctrlLeftClick = originalEvent.button === 0 && originalEvent.ctrlKey === true;
            const isRightClick = originalEvent.button === 2 || ctrlLeftClick;
            if (isRightClick) event.preventDefault();
          }),
          onFocusOutside: composeEventHandlers(
            props.onFocusOutside,
            (event) => event.preventDefault()
          )
        }
      );
    }
  );
  var DialogContentNonModal = React32.forwardRef(
    (props, forwardedRef) => {
      const context = useDialogContext(CONTENT_NAME2, props.__scopeDialog);
      const hasInteractedOutsideRef = React32.useRef(false);
      const hasPointerDownOutsideRef = React32.useRef(false);
      return /* @__PURE__ */ jsx(
        DialogContentImpl,
        {
          ...props,
          ref: forwardedRef,
          trapFocus: false,
          disableOutsidePointerEvents: false,
          onCloseAutoFocus: (event) => {
            props.onCloseAutoFocus?.(event);
            if (!event.defaultPrevented) {
              if (!hasInteractedOutsideRef.current) context.triggerRef.current?.focus();
              event.preventDefault();
            }
            hasInteractedOutsideRef.current = false;
            hasPointerDownOutsideRef.current = false;
          },
          onInteractOutside: (event) => {
            props.onInteractOutside?.(event);
            if (!event.defaultPrevented) {
              hasInteractedOutsideRef.current = true;
              if (event.detail.originalEvent.type === "pointerdown") {
                hasPointerDownOutsideRef.current = true;
              }
            }
            const target = event.target;
            const targetIsTrigger = context.triggerRef.current?.contains(target);
            if (targetIsTrigger) event.preventDefault();
            if (event.detail.originalEvent.type === "focusin" && hasPointerDownOutsideRef.current) {
              event.preventDefault();
            }
          }
        }
      );
    }
  );
  var DialogContentImpl = React32.forwardRef(
    (props, forwardedRef) => {
      const { __scopeDialog, trapFocus, onOpenAutoFocus, onCloseAutoFocus, ...contentProps } = props;
      const context = useDialogContext(CONTENT_NAME2, __scopeDialog);
      const contentRef = React32.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, contentRef);
      useFocusGuards();
      return /* @__PURE__ */ jsxs(Fragment8, { children: [
        /* @__PURE__ */ jsx(
          FocusScope,
          {
            asChild: true,
            loop: true,
            trapped: trapFocus,
            onMountAutoFocus: onOpenAutoFocus,
            onUnmountAutoFocus: onCloseAutoFocus,
            children: /* @__PURE__ */ jsx(
              DismissableLayer,
              {
                role: "dialog",
                id: context.contentId,
                "aria-describedby": context.descriptionId,
                "aria-labelledby": context.titleId,
                "data-state": getState(context.open),
                ...contentProps,
                ref: composedRefs,
                onDismiss: () => context.onOpenChange(false)
              }
            )
          }
        ),
        /* @__PURE__ */ jsxs(Fragment8, { children: [
          /* @__PURE__ */ jsx(TitleWarning, { titleId: context.titleId }),
          /* @__PURE__ */ jsx(DescriptionWarning, { contentRef, descriptionId: context.descriptionId })
        ] })
      ] });
    }
  );
  var TITLE_NAME = "DialogTitle";
  var DialogTitle = React32.forwardRef(
    (props, forwardedRef) => {
      const { __scopeDialog, ...titleProps } = props;
      const context = useDialogContext(TITLE_NAME, __scopeDialog);
      return /* @__PURE__ */ jsx(Primitive.h2, { id: context.titleId, ...titleProps, ref: forwardedRef });
    }
  );
  DialogTitle.displayName = TITLE_NAME;
  var DESCRIPTION_NAME = "DialogDescription";
  var DialogDescription = React32.forwardRef(
    (props, forwardedRef) => {
      const { __scopeDialog, ...descriptionProps } = props;
      const context = useDialogContext(DESCRIPTION_NAME, __scopeDialog);
      return /* @__PURE__ */ jsx(Primitive.p, { id: context.descriptionId, ...descriptionProps, ref: forwardedRef });
    }
  );
  DialogDescription.displayName = DESCRIPTION_NAME;
  var CLOSE_NAME = "DialogClose";
  var DialogClose = React32.forwardRef(
    (props, forwardedRef) => {
      const { __scopeDialog, ...closeProps } = props;
      const context = useDialogContext(CLOSE_NAME, __scopeDialog);
      return /* @__PURE__ */ jsx(
        Primitive.button,
        {
          type: "button",
          ...closeProps,
          ref: forwardedRef,
          onClick: composeEventHandlers(props.onClick, () => context.onOpenChange(false))
        }
      );
    }
  );
  DialogClose.displayName = CLOSE_NAME;
  function getState(open) {
    return open ? "open" : "closed";
  }
  var TITLE_WARNING_NAME = "DialogTitleWarning";
  var [WarningProvider, useWarningContext] = createContext22(TITLE_WARNING_NAME, {
    contentName: CONTENT_NAME2,
    titleName: TITLE_NAME,
    docsSlug: "dialog"
  });
  var TitleWarning = ({ titleId }) => {
    const titleWarningContext = useWarningContext(TITLE_WARNING_NAME);
    const MESSAGE = `\`${titleWarningContext.contentName}\` requires a \`${titleWarningContext.titleName}\` for the component to be accessible for screen reader users.

If you want to hide the \`${titleWarningContext.titleName}\`, you can wrap it with our VisuallyHidden component.

For more information, see https://radix-ui.com/primitives/docs/components/${titleWarningContext.docsSlug}`;
    React32.useEffect(() => {
      if (titleId) {
        const hasTitle = document.getElementById(titleId);
        if (!hasTitle) console.error(MESSAGE);
      }
    }, [MESSAGE, titleId]);
    return null;
  };
  var DESCRIPTION_WARNING_NAME = "DialogDescriptionWarning";
  var DescriptionWarning = ({ contentRef, descriptionId }) => {
    const descriptionWarningContext = useWarningContext(DESCRIPTION_WARNING_NAME);
    const MESSAGE = `Warning: Missing \`Description\` or \`aria-describedby={undefined}\` for {${descriptionWarningContext.contentName}}.`;
    React32.useEffect(() => {
      const describedById = contentRef.current?.getAttribute("aria-describedby");
      if (descriptionId && describedById) {
        const hasDescription = document.getElementById(descriptionId);
        if (!hasDescription) console.warn(MESSAGE);
      }
    }, [MESSAGE, contentRef, descriptionId]);
    return null;
  };
  var Root4 = Dialog;
  var Portal2 = DialogPortal;
  var Overlay = DialogOverlay;
  var Content2 = DialogContent;
  var Title = DialogTitle;
  var Description = DialogDescription;
  var Close = DialogClose;

  // ../stack-ui/dist/esm/components/ui/dialog.js
  var Dialog2 = Root4;
  var DialogPortal2 = Portal2;
  var DialogOverlay2 = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(Overlay, {
    ref,
    className: cn("stack-scope fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in", className),
    ...props
  }));
  DialogOverlay2.displayName = Overlay.displayName;
  var DialogContent2 = forwardRefIfNeeded(({ className, children, overlayProps, noCloseButton, ...props }, ref) => /* @__PURE__ */ jsxs(DialogPortal2, { children: [/* @__PURE__ */ jsx(DialogOverlay2, { ...overlayProps }), /* @__PURE__ */ jsxs(Content2, {
    ref,
    className: cn("stack-scope fixed left-[50%] top-[50%] max-h-screen z-50 flex flex-col w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border bg-background p-6 shadow-lg duration-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg", className),
    ...props,
    children: [children, !noCloseButton && /* @__PURE__ */ jsxs(Close, {
      className: "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground",
      children: [/* @__PURE__ */ jsx(Cross2Icon, { className: "h-4 w-4" }), /* @__PURE__ */ jsx("span", {
        className: "sr-only",
        children: "Close"
      })]
    })]
  })] }));
  DialogContent2.displayName = Content2.displayName;
  var DialogBody = ({ className, ...props }) => /* @__PURE__ */ jsx("div", {
    className: cn("stack-scope overflow-y-auto flex flex-col gap-4 w-[calc(100%+3rem)] -mx-6 px-6 my-2 py-2", className),
    ...props
  });
  var DialogHeader = ({ className, ...props }) => /* @__PURE__ */ jsx("div", {
    className: cn("stack-scope flex flex-col space-y-1.5 text-center sm:text-left", className),
    ...props
  });
  DialogHeader.displayName = "DialogHeader";
  var DialogFooter = ({ className, ...props }) => /* @__PURE__ */ jsx("div", {
    className: cn("stack-scope flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className),
    ...props
  });
  DialogFooter.displayName = "DialogFooter";
  var DialogTitle2 = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(Title, {
    ref,
    className: cn("stack-scope text-lg font-semibold leading-none tracking-tight", className),
    ...props
  }));
  DialogTitle2.displayName = Title.displayName;
  var DialogDescription2 = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(Description, {
    ref,
    className: cn("stack-scope text-sm text-muted-foreground", className),
    ...props
  }));
  DialogDescription2.displayName = Description.displayName;

  // ../../node_modules/.pnpm/@radix-ui+react-tooltip@1.1.3_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/@radix-ui/react-tooltip/dist/index.mjs
  var React34 = __toESM(require_react(), 1);
  var [createTooltipContext, createTooltipScope] = createContextScope2("Tooltip", [
    createPopperScope
  ]);
  var usePopperScope = createPopperScope();
  var PROVIDER_NAME = "TooltipProvider";
  var DEFAULT_DELAY_DURATION = 700;
  var TOOLTIP_OPEN = "tooltip.open";
  var [TooltipProviderContextProvider, useTooltipProviderContext] = createTooltipContext(PROVIDER_NAME);
  var TooltipProvider = (props) => {
    const {
      __scopeTooltip,
      delayDuration = DEFAULT_DELAY_DURATION,
      skipDelayDuration = 300,
      disableHoverableContent = false,
      children
    } = props;
    const [isOpenDelayed, setIsOpenDelayed] = React34.useState(true);
    const isPointerInTransitRef = React34.useRef(false);
    const skipDelayTimerRef = React34.useRef(0);
    React34.useEffect(() => {
      const skipDelayTimer = skipDelayTimerRef.current;
      return () => window.clearTimeout(skipDelayTimer);
    }, []);
    return /* @__PURE__ */ jsx(
      TooltipProviderContextProvider,
      {
        scope: __scopeTooltip,
        isOpenDelayed,
        delayDuration,
        onOpen: React34.useCallback(() => {
          window.clearTimeout(skipDelayTimerRef.current);
          setIsOpenDelayed(false);
        }, []),
        onClose: React34.useCallback(() => {
          window.clearTimeout(skipDelayTimerRef.current);
          skipDelayTimerRef.current = window.setTimeout(
            () => setIsOpenDelayed(true),
            skipDelayDuration
          );
        }, [skipDelayDuration]),
        isPointerInTransitRef,
        onPointerInTransitChange: React34.useCallback((inTransit) => {
          isPointerInTransitRef.current = inTransit;
        }, []),
        disableHoverableContent,
        children
      }
    );
  };
  TooltipProvider.displayName = PROVIDER_NAME;
  var TOOLTIP_NAME = "Tooltip";
  var [TooltipContextProvider, useTooltipContext] = createTooltipContext(TOOLTIP_NAME);
  var Tooltip = (props) => {
    const {
      __scopeTooltip,
      children,
      open: openProp,
      defaultOpen = false,
      onOpenChange,
      disableHoverableContent: disableHoverableContentProp,
      delayDuration: delayDurationProp
    } = props;
    const providerContext = useTooltipProviderContext(TOOLTIP_NAME, props.__scopeTooltip);
    const popperScope = usePopperScope(__scopeTooltip);
    const [trigger, setTrigger] = React34.useState(null);
    const contentId = useId();
    const openTimerRef = React34.useRef(0);
    const disableHoverableContent = disableHoverableContentProp ?? providerContext.disableHoverableContent;
    const delayDuration = delayDurationProp ?? providerContext.delayDuration;
    const wasOpenDelayedRef = React34.useRef(false);
    const [open = false, setOpen] = useControllableState({
      prop: openProp,
      defaultProp: defaultOpen,
      onChange: (open2) => {
        if (open2) {
          providerContext.onOpen();
          document.dispatchEvent(new CustomEvent(TOOLTIP_OPEN));
        } else {
          providerContext.onClose();
        }
        onOpenChange?.(open2);
      }
    });
    const stateAttribute = React34.useMemo(() => {
      return open ? wasOpenDelayedRef.current ? "delayed-open" : "instant-open" : "closed";
    }, [open]);
    const handleOpen = React34.useCallback(() => {
      window.clearTimeout(openTimerRef.current);
      wasOpenDelayedRef.current = false;
      setOpen(true);
    }, [setOpen]);
    const handleClose = React34.useCallback(() => {
      window.clearTimeout(openTimerRef.current);
      setOpen(false);
    }, [setOpen]);
    const handleDelayedOpen = React34.useCallback(() => {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = window.setTimeout(() => {
        wasOpenDelayedRef.current = true;
        setOpen(true);
      }, delayDuration);
    }, [delayDuration, setOpen]);
    React34.useEffect(() => {
      return () => window.clearTimeout(openTimerRef.current);
    }, []);
    return /* @__PURE__ */ jsx(Root2, { ...popperScope, children: /* @__PURE__ */ jsx(
      TooltipContextProvider,
      {
        scope: __scopeTooltip,
        contentId,
        open,
        stateAttribute,
        trigger,
        onTriggerChange: setTrigger,
        onTriggerEnter: React34.useCallback(() => {
          if (providerContext.isOpenDelayed) handleDelayedOpen();
          else handleOpen();
        }, [providerContext.isOpenDelayed, handleDelayedOpen, handleOpen]),
        onTriggerLeave: React34.useCallback(() => {
          if (disableHoverableContent) {
            handleClose();
          } else {
            window.clearTimeout(openTimerRef.current);
          }
        }, [handleClose, disableHoverableContent]),
        onOpen: handleOpen,
        onClose: handleClose,
        disableHoverableContent,
        children
      }
    ) });
  };
  Tooltip.displayName = TOOLTIP_NAME;
  var TRIGGER_NAME2 = "TooltipTrigger";
  var TooltipTrigger = React34.forwardRef(
    (props, forwardedRef) => {
      const { __scopeTooltip, ...triggerProps } = props;
      const context = useTooltipContext(TRIGGER_NAME2, __scopeTooltip);
      const providerContext = useTooltipProviderContext(TRIGGER_NAME2, __scopeTooltip);
      const popperScope = usePopperScope(__scopeTooltip);
      const ref = React34.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, ref, context.onTriggerChange);
      const isPointerDownRef = React34.useRef(false);
      const hasPointerMoveOpenedRef = React34.useRef(false);
      const handlePointerUp = React34.useCallback(() => isPointerDownRef.current = false, []);
      React34.useEffect(() => {
        return () => document.removeEventListener("pointerup", handlePointerUp);
      }, [handlePointerUp]);
      return /* @__PURE__ */ jsx(Anchor, { asChild: true, ...popperScope, children: /* @__PURE__ */ jsx(
        Primitive.button,
        {
          "aria-describedby": context.open ? context.contentId : void 0,
          "data-state": context.stateAttribute,
          ...triggerProps,
          ref: composedRefs,
          onPointerMove: composeEventHandlers(props.onPointerMove, (event) => {
            if (event.pointerType === "touch") return;
            if (!hasPointerMoveOpenedRef.current && !providerContext.isPointerInTransitRef.current) {
              context.onTriggerEnter();
              hasPointerMoveOpenedRef.current = true;
            }
          }),
          onPointerLeave: composeEventHandlers(props.onPointerLeave, () => {
            context.onTriggerLeave();
            hasPointerMoveOpenedRef.current = false;
          }),
          onPointerDown: composeEventHandlers(props.onPointerDown, () => {
            isPointerDownRef.current = true;
            document.addEventListener("pointerup", handlePointerUp, { once: true });
          }),
          onFocus: composeEventHandlers(props.onFocus, () => {
            if (!isPointerDownRef.current) context.onOpen();
          }),
          onBlur: composeEventHandlers(props.onBlur, context.onClose),
          onClick: composeEventHandlers(props.onClick, context.onClose)
        }
      ) });
    }
  );
  TooltipTrigger.displayName = TRIGGER_NAME2;
  var PORTAL_NAME3 = "TooltipPortal";
  var [PortalProvider2, usePortalContext2] = createTooltipContext(PORTAL_NAME3, {
    forceMount: void 0
  });
  var TooltipPortal = (props) => {
    const { __scopeTooltip, forceMount, children, container } = props;
    const context = useTooltipContext(PORTAL_NAME3, __scopeTooltip);
    return /* @__PURE__ */ jsx(PortalProvider2, { scope: __scopeTooltip, forceMount, children: /* @__PURE__ */ jsx(Presence, { present: forceMount || context.open, children: /* @__PURE__ */ jsx(Portal, { asChild: true, container, children }) }) });
  };
  TooltipPortal.displayName = PORTAL_NAME3;
  var CONTENT_NAME3 = "TooltipContent";
  var TooltipContent = React34.forwardRef(
    (props, forwardedRef) => {
      const portalContext = usePortalContext2(CONTENT_NAME3, props.__scopeTooltip);
      const { forceMount = portalContext.forceMount, side = "top", ...contentProps } = props;
      const context = useTooltipContext(CONTENT_NAME3, props.__scopeTooltip);
      return /* @__PURE__ */ jsx(Presence, { present: forceMount || context.open, children: context.disableHoverableContent ? /* @__PURE__ */ jsx(TooltipContentImpl, { side, ...contentProps, ref: forwardedRef }) : /* @__PURE__ */ jsx(TooltipContentHoverable, { side, ...contentProps, ref: forwardedRef }) });
    }
  );
  var TooltipContentHoverable = React34.forwardRef((props, forwardedRef) => {
    const context = useTooltipContext(CONTENT_NAME3, props.__scopeTooltip);
    const providerContext = useTooltipProviderContext(CONTENT_NAME3, props.__scopeTooltip);
    const ref = React34.useRef(null);
    const composedRefs = useComposedRefs(forwardedRef, ref);
    const [pointerGraceArea, setPointerGraceArea] = React34.useState(null);
    const { trigger, onClose } = context;
    const content = ref.current;
    const { onPointerInTransitChange } = providerContext;
    const handleRemoveGraceArea = React34.useCallback(() => {
      setPointerGraceArea(null);
      onPointerInTransitChange(false);
    }, [onPointerInTransitChange]);
    const handleCreateGraceArea = React34.useCallback(
      (event, hoverTarget) => {
        const currentTarget = event.currentTarget;
        const exitPoint = { x: event.clientX, y: event.clientY };
        const exitSide = getExitSideFromRect(exitPoint, currentTarget.getBoundingClientRect());
        const paddedExitPoints = getPaddedExitPoints(exitPoint, exitSide);
        const hoverTargetPoints = getPointsFromRect(hoverTarget.getBoundingClientRect());
        const graceArea = getHull([...paddedExitPoints, ...hoverTargetPoints]);
        setPointerGraceArea(graceArea);
        onPointerInTransitChange(true);
      },
      [onPointerInTransitChange]
    );
    React34.useEffect(() => {
      return () => handleRemoveGraceArea();
    }, [handleRemoveGraceArea]);
    React34.useEffect(() => {
      if (trigger && content) {
        const handleTriggerLeave = (event) => handleCreateGraceArea(event, content);
        const handleContentLeave = (event) => handleCreateGraceArea(event, trigger);
        trigger.addEventListener("pointerleave", handleTriggerLeave);
        content.addEventListener("pointerleave", handleContentLeave);
        return () => {
          trigger.removeEventListener("pointerleave", handleTriggerLeave);
          content.removeEventListener("pointerleave", handleContentLeave);
        };
      }
    }, [trigger, content, handleCreateGraceArea, handleRemoveGraceArea]);
    React34.useEffect(() => {
      if (pointerGraceArea) {
        const handleTrackPointerGrace = (event) => {
          const target = event.target;
          const pointerPosition = { x: event.clientX, y: event.clientY };
          const hasEnteredTarget = trigger?.contains(target) || content?.contains(target);
          const isPointerOutsideGraceArea = !isPointInPolygon(pointerPosition, pointerGraceArea);
          if (hasEnteredTarget) {
            handleRemoveGraceArea();
          } else if (isPointerOutsideGraceArea) {
            handleRemoveGraceArea();
            onClose();
          }
        };
        document.addEventListener("pointermove", handleTrackPointerGrace);
        return () => document.removeEventListener("pointermove", handleTrackPointerGrace);
      }
    }, [trigger, content, pointerGraceArea, onClose, handleRemoveGraceArea]);
    return /* @__PURE__ */ jsx(TooltipContentImpl, { ...props, ref: composedRefs });
  });
  var [VisuallyHiddenContentContextProvider, useVisuallyHiddenContentContext] = createTooltipContext(TOOLTIP_NAME, { isInside: false });
  var TooltipContentImpl = React34.forwardRef(
    (props, forwardedRef) => {
      const {
        __scopeTooltip,
        children,
        "aria-label": ariaLabel,
        onEscapeKeyDown,
        onPointerDownOutside,
        ...contentProps
      } = props;
      const context = useTooltipContext(CONTENT_NAME3, __scopeTooltip);
      const popperScope = usePopperScope(__scopeTooltip);
      const { onClose } = context;
      React34.useEffect(() => {
        document.addEventListener(TOOLTIP_OPEN, onClose);
        return () => document.removeEventListener(TOOLTIP_OPEN, onClose);
      }, [onClose]);
      React34.useEffect(() => {
        if (context.trigger) {
          const handleScroll2 = (event) => {
            const target = event.target;
            if (target?.contains(context.trigger)) onClose();
          };
          window.addEventListener("scroll", handleScroll2, { capture: true });
          return () => window.removeEventListener("scroll", handleScroll2, { capture: true });
        }
      }, [context.trigger, onClose]);
      return /* @__PURE__ */ jsx(
        DismissableLayer,
        {
          asChild: true,
          disableOutsidePointerEvents: false,
          onEscapeKeyDown,
          onPointerDownOutside,
          onFocusOutside: (event) => event.preventDefault(),
          onDismiss: onClose,
          children: /* @__PURE__ */ jsxs(
            Content,
            {
              "data-state": context.stateAttribute,
              ...popperScope,
              ...contentProps,
              ref: forwardedRef,
              style: {
                ...contentProps.style,
                // re-namespace exposed content custom properties
                ...{
                  "--radix-tooltip-content-transform-origin": "var(--radix-popper-transform-origin)",
                  "--radix-tooltip-content-available-width": "var(--radix-popper-available-width)",
                  "--radix-tooltip-content-available-height": "var(--radix-popper-available-height)",
                  "--radix-tooltip-trigger-width": "var(--radix-popper-anchor-width)",
                  "--radix-tooltip-trigger-height": "var(--radix-popper-anchor-height)"
                }
              },
              children: [
                /* @__PURE__ */ jsx(Slottable, { children }),
                /* @__PURE__ */ jsx(VisuallyHiddenContentContextProvider, { scope: __scopeTooltip, isInside: true, children: /* @__PURE__ */ jsx(Root3, { id: context.contentId, role: "tooltip", children: ariaLabel || children }) })
              ]
            }
          )
        }
      );
    }
  );
  TooltipContent.displayName = CONTENT_NAME3;
  var ARROW_NAME2 = "TooltipArrow";
  var TooltipArrow = React34.forwardRef(
    (props, forwardedRef) => {
      const { __scopeTooltip, ...arrowProps } = props;
      const popperScope = usePopperScope(__scopeTooltip);
      const visuallyHiddenContentContext = useVisuallyHiddenContentContext(
        ARROW_NAME2,
        __scopeTooltip
      );
      return visuallyHiddenContentContext.isInside ? null : /* @__PURE__ */ jsx(Arrow2, { ...popperScope, ...arrowProps, ref: forwardedRef });
    }
  );
  TooltipArrow.displayName = ARROW_NAME2;
  function getExitSideFromRect(point, rect) {
    const top = Math.abs(rect.top - point.y);
    const bottom = Math.abs(rect.bottom - point.y);
    const right = Math.abs(rect.right - point.x);
    const left = Math.abs(rect.left - point.x);
    switch (Math.min(top, bottom, right, left)) {
      case left:
        return "left";
      case right:
        return "right";
      case top:
        return "top";
      case bottom:
        return "bottom";
      default:
        throw new Error("unreachable");
    }
  }
  function getPaddedExitPoints(exitPoint, exitSide, padding = 5) {
    const paddedExitPoints = [];
    switch (exitSide) {
      case "top":
        paddedExitPoints.push(
          { x: exitPoint.x - padding, y: exitPoint.y + padding },
          { x: exitPoint.x + padding, y: exitPoint.y + padding }
        );
        break;
      case "bottom":
        paddedExitPoints.push(
          { x: exitPoint.x - padding, y: exitPoint.y - padding },
          { x: exitPoint.x + padding, y: exitPoint.y - padding }
        );
        break;
      case "left":
        paddedExitPoints.push(
          { x: exitPoint.x + padding, y: exitPoint.y - padding },
          { x: exitPoint.x + padding, y: exitPoint.y + padding }
        );
        break;
      case "right":
        paddedExitPoints.push(
          { x: exitPoint.x - padding, y: exitPoint.y - padding },
          { x: exitPoint.x - padding, y: exitPoint.y + padding }
        );
        break;
    }
    return paddedExitPoints;
  }
  function getPointsFromRect(rect) {
    const { top, right, bottom, left } = rect;
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ];
  }
  function isPointInPolygon(point, polygon) {
    const { x, y } = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect = yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function getHull(points) {
    const newPoints = points.slice();
    newPoints.sort((a8, b) => {
      if (a8.x < b.x) return -1;
      else if (a8.x > b.x) return 1;
      else if (a8.y < b.y) return -1;
      else if (a8.y > b.y) return 1;
      else return 0;
    });
    return getHullPresorted(newPoints);
  }
  function getHullPresorted(points) {
    if (points.length <= 1) return points.slice();
    const upperHull = [];
    for (let i = 0; i < points.length; i++) {
      const p2 = points[i];
      while (upperHull.length >= 2) {
        const q = upperHull[upperHull.length - 1];
        const r5 = upperHull[upperHull.length - 2];
        if ((q.x - r5.x) * (p2.y - r5.y) >= (q.y - r5.y) * (p2.x - r5.x)) upperHull.pop();
        else break;
      }
      upperHull.push(p2);
    }
    upperHull.pop();
    const lowerHull = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p2 = points[i];
      while (lowerHull.length >= 2) {
        const q = lowerHull[lowerHull.length - 1];
        const r5 = lowerHull[lowerHull.length - 2];
        if ((q.x - r5.x) * (p2.y - r5.y) >= (q.y - r5.y) * (p2.x - r5.x)) lowerHull.pop();
        else break;
      }
      lowerHull.push(p2);
    }
    lowerHull.pop();
    if (upperHull.length === 1 && lowerHull.length === 1 && upperHull[0].x === lowerHull[0].x && upperHull[0].y === lowerHull[0].y) {
      return upperHull;
    } else {
      return upperHull.concat(lowerHull);
    }
  }
  var Provider = TooltipProvider;
  var Root32 = Tooltip;
  var Trigger2 = TooltipTrigger;
  var Content22 = TooltipContent;

  // ../stack-ui/dist/esm/components/ui/card.js
  var Card = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("div", {
    ref,
    className: cn("rounded-xl border bg-card text-card-foreground shadow-sm", className),
    ...props
  }));
  Card.displayName = "Card";
  var CardHeader = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("div", {
    ref,
    className: cn("flex flex-col space-y-1.5 p-6 pb-0", className),
    ...props
  }));
  CardHeader.displayName = "CardHeader";
  var CardTitle = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("h3", {
    ref,
    className: cn("font-semibold leading-none tracking-tight capitalize", className),
    ...props
  }));
  CardTitle.displayName = "CardTitle";
  var CardDescription = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("p", {
    ref,
    className: cn("text-sm text-muted-foreground", className),
    ...props
  }));
  CardDescription.displayName = "CardDescription";
  var CardContent = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("div", {
    ref,
    className: cn("p-6", className),
    ...props
  }));
  CardContent.displayName = "CardContent";
  var CardSubtitle = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("h4", {
    ref,
    className: cn("text-sm text-muted-foreground font-bold", className),
    ...props
  }));
  var CardFooter = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("div", {
    ref,
    className: cn("flex items-center p-6 pt-0", className),
    ...props
  }));
  CardFooter.displayName = "CardFooter";

  // ../stack-ui/dist/esm/components/ui/tooltip.js
  var import_react13 = __toESM(require_react());
  var TooltipProvider2 = forwardRefIfNeeded((props, ref) => /* @__PURE__ */ jsx(Provider, {
    delayDuration: 0,
    ...props
  }));
  TooltipProvider2.displayName = Provider.displayName;
  var Tooltip2 = Root32;
  var TooltipTrigger2 = Trigger2;
  var TooltipContent2 = forwardRefIfNeeded(({ className, sideOffset = 4, ...props }, ref) => /* @__PURE__ */ jsx(Content22, {
    ref,
    sideOffset,
    className: cn("stack-scope z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2", className),
    ...props
  }));
  TooltipContent2.displayName = Content22.displayName;

  // src/components/alert.tsx
  var variantIconMap = /* @__PURE__ */ new Map([
    ["default", c2],
    ["success", s],
    ["error", s3],
    ["warning", m],
    ["info", c2]
  ]);
  var variantStyles = /* @__PURE__ */ new Map([
    [
      "default",
      {
        container: "bg-background border-border",
        icon: "text-foreground",
        title: "text-foreground"
      }
    ],
    [
      "success",
      {
        container: "bg-green-500/[0.06] border-green-500/30",
        icon: "text-green-500",
        title: "text-green-600 dark:text-green-400"
      }
    ],
    [
      "error",
      {
        container: "bg-red-500/[0.06] border-red-500/30",
        icon: "text-red-500",
        title: "text-red-600 dark:text-red-400"
      }
    ],
    [
      "warning",
      {
        container: "bg-amber-500/[0.08] border-amber-500/40",
        icon: "text-amber-600 dark:text-amber-400",
        title: "text-amber-700 dark:text-amber-300"
      }
    ],
    [
      "info",
      {
        container: "bg-blue-500/[0.06] border-blue-500/30",
        icon: "text-blue-500",
        title: "text-blue-600 dark:text-blue-400"
      }
    ]
  ]);
  function getMapValueOrThrow(map, key, mapName) {
    const value = map.get(key);
    if (!value) {
      throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
    }
    return value;
  }
  function DesignAlert({
    variant = "default",
    title,
    description,
    glassmorphic = false,
    className,
    children,
    ...props
  }) {
    const styles = getMapValueOrThrow(variantStyles, variant, "variantStyles");
    const Icon = getMapValueOrThrow(variantIconMap, variant, "variantIconMap");
    return /* @__PURE__ */ jsxs(
      "div",
      {
        role: "alert",
        className: cn(
          "relative w-full rounded-2xl border p-4 text-sm",
          "flex gap-3 items-start",
          styles.container,
          glassmorphic && "backdrop-blur-xl",
          className
        ),
        ...props,
        children: [
          /* @__PURE__ */ jsx(Icon, { className: cn("h-4 w-4 mt-0.5 flex-shrink-0", styles.icon) }),
          /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
            title && /* @__PURE__ */ jsx("h5", { className: cn("mb-1 font-medium leading-none tracking-tight", styles.title), children: title }),
            description && /* @__PURE__ */ jsx("div", { className: "text-sm text-foreground/80 dark:text-muted-foreground [&_p]:leading-relaxed", children: description }),
            children
          ] })
        ]
      }
    );
  }

  // src/components/badge.tsx
  var badgeStyles = /* @__PURE__ */ new Map([
    ["blue", "text-blue-700 dark:text-blue-400 bg-blue-500/20 dark:bg-blue-500/10 ring-1 ring-blue-500/30 dark:ring-blue-500/20"],
    ["cyan", "text-cyan-700 dark:text-cyan-400 bg-cyan-500/20 dark:bg-cyan-500/10 ring-1 ring-cyan-500/30 dark:ring-cyan-500/20"],
    ["purple", "text-purple-700 dark:text-purple-400 bg-purple-500/20 dark:bg-purple-500/10 ring-1 ring-purple-500/30 dark:ring-purple-500/20"],
    ["green", "text-emerald-700 dark:text-emerald-400 bg-emerald-500/20 dark:bg-emerald-500/10 ring-1 ring-emerald-500/30 dark:ring-emerald-500/20"],
    ["orange", "text-amber-700 dark:text-amber-300 bg-amber-500/20 dark:bg-amber-500/10 ring-1 ring-amber-500/30 dark:ring-amber-500/20"],
    ["red", "text-red-700 dark:text-red-400 bg-red-500/20 dark:bg-red-500/10 ring-1 ring-red-500/30 dark:ring-red-500/20"]
  ]);
  function getMapValueOrThrow2(map, key, mapName) {
    const value = map.get(key);
    if (!value) {
      throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
    }
    return value;
  }
  function getShowLabelShowIcon(contentMode, hasIcon) {
    switch (contentMode) {
      case "both": {
        return { showLabel: true, showIcon: hasIcon };
      }
      case "text": {
        return { showLabel: true, showIcon: false };
      }
      case "icon": {
        if (!hasIcon) {
          throw new Error("DesignBadge contentMode 'icon' requires the icon prop to be provided.");
        }
        return { showLabel: false, showIcon: true };
      }
      default: {
        const _exhaustive = contentMode;
        throw new Error(`Unknown contentMode: ${String(_exhaustive)}`);
      }
    }
  }
  function DesignBadge({
    label,
    color,
    icon,
    size: size5 = "md",
    contentMode = "both"
  }) {
    const Icon = icon;
    const { showLabel, showIcon } = getShowLabelShowIcon(contentMode, !!Icon);
    if (!showLabel && !showIcon) {
      throw new Error("DesignBadge must show at least label or icon.");
    }
    const sizeClasses2 = size5 === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";
    const colorClasses = getMapValueOrThrow2(badgeStyles, color, "badgeStyles");
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium",
          colorClasses,
          sizeClasses2
        ),
        title: !showLabel ? label : void 0,
        "aria-label": label,
        children: [
          showIcon && Icon && /* @__PURE__ */ jsx(Icon, { className: "h-3 w-3" }),
          showLabel ? label : null
        ]
      }
    );
  }

  // ../../node_modules/.pnpm/@radix-ui+react-slot@1.2.4_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-slot/dist/index.mjs
  var React37 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-compose-refs@1.1.2_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-compose-refs/dist/index.mjs
  var React36 = __toESM(require_react(), 1);
  function setRef2(ref, value) {
    if (typeof ref === "function") {
      return ref(value);
    } else if (ref !== null && ref !== void 0) {
      ref.current = value;
    }
  }
  function composeRefs2(...refs) {
    return (node) => {
      let hasCleanup = false;
      const cleanups = refs.map((ref) => {
        const cleanup = setRef2(ref, node);
        if (!hasCleanup && typeof cleanup == "function") {
          hasCleanup = true;
        }
        return cleanup;
      });
      if (hasCleanup) {
        return () => {
          for (let i = 0; i < cleanups.length; i++) {
            const cleanup = cleanups[i];
            if (typeof cleanup == "function") {
              cleanup();
            } else {
              setRef2(refs[i], null);
            }
          }
        };
      }
    };
  }
  function useComposedRefs2(...refs) {
    return React36.useCallback(composeRefs2(...refs), refs);
  }

  // ../../node_modules/.pnpm/@radix-ui+react-slot@1.2.4_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-slot/dist/index.mjs
  var REACT_LAZY_TYPE = Symbol.for("react.lazy");
  var use = React37[" use ".trim().toString()];
  function isPromiseLike(value) {
    return typeof value === "object" && value !== null && "then" in value;
  }
  function isLazyComponent(element) {
    return element != null && typeof element === "object" && "$$typeof" in element && element.$$typeof === REACT_LAZY_TYPE && "_payload" in element && isPromiseLike(element._payload);
  }
  // @__NO_SIDE_EFFECTS__
  function createSlot(ownerName) {
    const SlotClone2 = /* @__PURE__ */ createSlotClone(ownerName);
    const Slot22 = React37.forwardRef((props, forwardedRef) => {
      let { children, ...slotProps } = props;
      if (isLazyComponent(children) && typeof use === "function") {
        children = use(children._payload);
      }
      const childrenArray = React37.Children.toArray(children);
      const slottable = childrenArray.find(isSlottable2);
      if (slottable) {
        const newElement = slottable.props.children;
        const newChildren = childrenArray.map((child) => {
          if (child === slottable) {
            if (React37.Children.count(newElement) > 1) return React37.Children.only(null);
            return React37.isValidElement(newElement) ? newElement.props.children : null;
          } else {
            return child;
          }
        });
        return /* @__PURE__ */ jsx(SlotClone2, { ...slotProps, ref: forwardedRef, children: React37.isValidElement(newElement) ? React37.cloneElement(newElement, void 0, newChildren) : null });
      }
      return /* @__PURE__ */ jsx(SlotClone2, { ...slotProps, ref: forwardedRef, children });
    });
    Slot22.displayName = `${ownerName}.Slot`;
    return Slot22;
  }
  var Slot2 = /* @__PURE__ */ createSlot("Slot");
  // @__NO_SIDE_EFFECTS__
  function createSlotClone(ownerName) {
    const SlotClone2 = React37.forwardRef((props, forwardedRef) => {
      let { children, ...slotProps } = props;
      if (isLazyComponent(children) && typeof use === "function") {
        children = use(children._payload);
      }
      if (React37.isValidElement(children)) {
        const childrenRef = getElementRef3(children);
        const props2 = mergeProps2(slotProps, children.props);
        if (children.type !== React37.Fragment) {
          props2.ref = forwardedRef ? composeRefs2(forwardedRef, childrenRef) : childrenRef;
        }
        return React37.cloneElement(children, props2);
      }
      return React37.Children.count(children) > 1 ? React37.Children.only(null) : null;
    });
    SlotClone2.displayName = `${ownerName}.SlotClone`;
    return SlotClone2;
  }
  var SLOTTABLE_IDENTIFIER = Symbol("radix.slottable");
  // @__NO_SIDE_EFFECTS__
  function createSlottable(ownerName) {
    const Slottable22 = ({ children }) => {
      return /* @__PURE__ */ jsx(Fragment8, { children });
    };
    Slottable22.displayName = `${ownerName}.Slottable`;
    Slottable22.__radixId = SLOTTABLE_IDENTIFIER;
    return Slottable22;
  }
  var Slottable2 = /* @__PURE__ */ createSlottable("Slottable");
  function isSlottable2(child) {
    return React37.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER;
  }
  function mergeProps2(slotProps, childProps) {
    const overrideProps = { ...childProps };
    for (const propName in childProps) {
      const slotPropValue = slotProps[propName];
      const childPropValue = childProps[propName];
      const isHandler = /^on[A-Z]/.test(propName);
      if (isHandler) {
        if (slotPropValue && childPropValue) {
          overrideProps[propName] = (...args) => {
            const result = childPropValue(...args);
            slotPropValue(...args);
            return result;
          };
        } else if (slotPropValue) {
          overrideProps[propName] = slotPropValue;
        }
      } else if (propName === "style") {
        overrideProps[propName] = { ...slotPropValue, ...childPropValue };
      } else if (propName === "className") {
        overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
      }
    }
    return { ...slotProps, ...overrideProps };
  }
  function getElementRef3(element) {
    let getter2 = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
    let mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.ref;
    }
    getter2 = Object.getOwnPropertyDescriptor(element, "ref")?.get;
    mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.props.ref;
    }
    return element.props.ref || element.ref;
  }

  // ../../node_modules/.pnpm/class-variance-authority@0.7.1/node_modules/class-variance-authority/dist/index.mjs
  var falsyToString = (value) => typeof value === "boolean" ? `${value}` : value === 0 ? "0" : value;
  var cx = clsx;
  var cva = (base, config) => (props) => {
    var _config_compoundVariants;
    if ((config === null || config === void 0 ? void 0 : config.variants) == null) return cx(base, props === null || props === void 0 ? void 0 : props.class, props === null || props === void 0 ? void 0 : props.className);
    const { variants, defaultVariants } = config;
    const getVariantClassNames = Object.keys(variants).map((variant) => {
      const variantProp = props === null || props === void 0 ? void 0 : props[variant];
      const defaultVariantProp = defaultVariants === null || defaultVariants === void 0 ? void 0 : defaultVariants[variant];
      if (variantProp === null) return null;
      const variantKey = falsyToString(variantProp) || falsyToString(defaultVariantProp);
      return variants[variant][variantKey];
    });
    const propsWithoutUndefined = props && Object.entries(props).reduce((acc, param) => {
      let [key, value] = param;
      if (value === void 0) {
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {});
    const getCompoundVariantClassNames = config === null || config === void 0 ? void 0 : (_config_compoundVariants = config.compoundVariants) === null || _config_compoundVariants === void 0 ? void 0 : _config_compoundVariants.reduce((acc, param) => {
      let { class: cvClass, className: cvClassName, ...compoundVariantOptions } = param;
      return Object.entries(compoundVariantOptions).every((param2) => {
        let [key, value] = param2;
        return Array.isArray(value) ? value.includes({
          ...defaultVariants,
          ...propsWithoutUndefined
        }[key]) : {
          ...defaultVariants,
          ...propsWithoutUndefined
        }[key] === value;
      }) ? [
        ...acc,
        cvClass,
        cvClassName
      ] : acc;
    }, []);
    return cx(base, getVariantClassNames, getCompoundVariantClassNames, props === null || props === void 0 ? void 0 : props.class, props === null || props === void 0 ? void 0 : props.className);
  };

  // src/components/button.tsx
  var designButtonVariants = cva(
    "stack-scope inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground hover:bg-primary/90",
          destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          outline: "border border-input bg-white/85 dark:bg-background hover:bg-white dark:hover:bg-accent hover:text-accent-foreground",
          secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          ghost: "hover:bg-accent hover:text-accent-foreground",
          link: "text-primary underline-offset-4 hover:underline",
          plain: ""
        },
        size: {
          default: "h-9 px-4 py-2",
          sm: "h-8 rounded-md px-3 text-xs",
          lg: "h-10 rounded-md px-8",
          icon: "h-9 w-9"
        }
      },
      defaultVariants: {
        variant: "default",
        size: "default"
      }
    }
  );
  var DesignOriginalButton = forwardRefIfNeeded(
    ({ className, variant, size: size5, asChild = false, ...props }, ref) => {
      const Comp = asChild ? Slot2 : "button";
      return /* @__PURE__ */ jsx(
        Comp,
        {
          className: cn(designButtonVariants({ variant, size: size5, className })),
          ref,
          ...props
        }
      );
    }
  );
  DesignOriginalButton.displayName = "DesignButton";
  var DesignButton = forwardRefIfNeeded(
    ({ onClick, loading: loadingProp, loadingStyle = "spinner", children, size: size5, ...props }, ref) => {
      const [handleClick, isLoading] = useAsyncCallback(async (e15) => {
        await onClick?.(e15);
      }, [onClick]);
      const loading = loadingProp || isLoading;
      return /* @__PURE__ */ jsxs(
        DesignOriginalButton,
        {
          ...props,
          ref,
          disabled: props.disabled || loading,
          onClick: (e15) => runAsynchronouslyWithAlert(handleClick(e15)),
          size: size5,
          className: cn("relative", loading && "[&>:not(.stack-button-do-not-hide-when-siblings-are)]:invisible", props.className),
          children: [
            loadingStyle === "spinner" && /* @__PURE__ */ jsx(Spinner, { className: cn("absolute inset-0 flex items-center justify-center stack-button-do-not-hide-when-siblings-are", !loading && "invisible") }),
            /* @__PURE__ */ jsx(Slottable2, { children: typeof children === "string" ? /* @__PURE__ */ jsx("span", { children }) : children })
          ]
        }
      );
    }
  );
  DesignButton.displayName = "DesignButton";

  // src/components/card.tsx
  var import_react17 = __toESM(require_react());
  var DesignCardNestingContext = import_react17.default.createContext(false);
  function useInsideDesignCard() {
    return import_react17.default.useContext(DesignCardNestingContext);
  }
  function useGlassmorphicDefault(explicit) {
    const insideCard = useInsideDesignCard();
    return explicit ?? insideCard;
  }
  var hoverTintClasses = /* @__PURE__ */ new Map([
    ["blue", "group-hover:bg-blue-500/[0.03]"],
    ["purple", "group-hover:bg-purple-500/[0.03]"],
    ["green", "group-hover:bg-emerald-500/[0.03]"],
    ["orange", "group-hover:bg-orange-500/[0.03]"],
    ["default", "group-hover:bg-slate-500/[0.02]"],
    ["cyan", "group-hover:bg-cyan-500/[0.03]"]
  ]);
  var demoTintClasses = /* @__PURE__ */ new Map([
    ["blue", "group-hover/tint:bg-blue-500/[0.02]"],
    ["purple", "group-hover/tint:bg-purple-500/[0.02]"],
    ["green", "group-hover/tint:bg-emerald-500/[0.02]"],
    ["orange", "group-hover/tint:bg-orange-500/[0.02]"],
    ["default", "group-hover/tint:bg-slate-500/[0.015]"],
    ["cyan", "group-hover/tint:bg-cyan-500/[0.02]"]
  ]);
  var bodyPaddingClass = "p-5";
  function DesignCard({
    title,
    subtitle,
    icon: Icon,
    actions,
    glassmorphic: glassmorphicProp,
    gradient = "default",
    children,
    className,
    contentClassName,
    ...props
  }) {
    const glassmorphic = glassmorphicProp ?? true;
    const hoverTintClass = hoverTintClasses.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";
    const hasContent = import_react17.default.Children.count(children) > 0;
    const variant = title != null ? subtitle != null ? "header" : "compact" : "bodyOnly";
    return /* @__PURE__ */ jsx(DesignCardNestingContext.Provider, { value: true, children: /* @__PURE__ */ jsxs(
      Card,
      {
        className: cn(
          "group relative rounded-2xl overflow-hidden",
          glassmorphic && [
            "bg-white/90 dark:bg-background/60 dark:backdrop-blur-xl border-0 transition-all duration-150 hover:transition-none",
            "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
            "shadow-none"
          ],
          glassmorphic && variant === "bodyOnly" && "dark:bg-transparent dark:ring-0 dark:shadow-none",
          className
        ),
        ...props,
        children: [
          glassmorphic && /* @__PURE__ */ jsxs(Fragment8, { children: [
            /* @__PURE__ */ jsx("div", { className: cn(
              "absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl",
              variant === "bodyOnly" && "dark:hidden"
            ) }),
            variant !== "bodyOnly" && /* @__PURE__ */ jsx(
              "div",
              {
                className: cn(
                  "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl",
                  hoverTintClass
                )
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "relative", children: [
            variant === "header" && /* @__PURE__ */ jsx("div", { className: bodyPaddingClass, children: /* @__PURE__ */ jsxs("div", { className: "flex items-start justify-between gap-4", children: [
              /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
                /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
                  Icon && /* @__PURE__ */ jsx("div", { className: "p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]", children: /* @__PURE__ */ jsx(Icon, { className: "h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" }) }),
                  /* @__PURE__ */ jsx("span", { className: "text-xs font-semibold text-foreground uppercase tracking-wider", children: title })
                ] }),
                subtitle && /* @__PURE__ */ jsx("p", { className: "text-sm text-muted-foreground mt-1", children: subtitle })
              ] }),
              actions && /* @__PURE__ */ jsx("div", { className: "flex-shrink-0", children: actions })
            ] }) }),
            variant === "compact" && /* @__PURE__ */ jsxs("div", { className: "p-5 flex items-center justify-between gap-4 border-b border-black/[0.12] dark:border-white/[0.06]", children: [
              /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [
                Icon && /* @__PURE__ */ jsx("div", { className: "p-1.5 rounded-lg bg-foreground/[0.04]", children: /* @__PURE__ */ jsx(Icon, { className: "h-3.5 w-3.5 text-muted-foreground" }) }),
                /* @__PURE__ */ jsx("span", { className: "text-xs font-semibold text-foreground uppercase tracking-wider", children: title })
              ] }),
              actions && /* @__PURE__ */ jsx("div", { className: "flex-shrink-0", children: actions })
            ] }),
            hasContent && /* @__PURE__ */ jsx(
              "div",
              {
                className: cn(
                  variant === "header" ? "border-t border-black/[0.12] dark:border-white/[0.06]" : "",
                  variant === "compact" ? "px-5 py-4" : "",
                  variant === "bodyOnly" || variant === "header" ? bodyPaddingClass : "",
                  contentClassName
                ),
                children
              }
            )
          ] })
        ]
      }
    ) });
  }
  function DesignCardTint({
    gradient,
    className,
    children,
    ...props
  }) {
    const tintClass = demoTintClasses.get(gradient) ?? "group-hover/tint:bg-slate-500/[0.015]";
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: cn(
          "group/tint relative rounded-2xl bg-white/90 dark:bg-background/60 dark:backdrop-blur-xl transition-all duration-150 hover:transition-none",
          "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
          "shadow-none overflow-hidden",
          className
        ),
        ...props,
        children: [
          /* @__PURE__ */ jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl" }),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: cn(
                "absolute inset-0 transition-colors duration-150 group-hover/tint:transition-none pointer-events-none rounded-2xl",
                tintClass
              )
            }
          ),
          /* @__PURE__ */ jsx("div", { className: "relative", children })
        ]
      }
    );
  }

  // src/components/cursor-blast-effect.tsx
  var import_react18 = __toESM(require_react());
  var import_react_dom3 = __toESM(require_react_dom());
  var DEFAULT_BLAST_LIFETIME_MS = 720;
  var DEFAULT_MAX_ACTIVE_BLASTS = 18;
  var DEFAULT_RAGE_CLICK_THRESHOLD = 3;
  var DEFAULT_RAGE_CLICK_WINDOW_MS = 600;
  var DEFAULT_RAGE_CLICK_RADIUS_PX = 60;
  function CursorBlastEffect({
    blastLifetimeMs = DEFAULT_BLAST_LIFETIME_MS,
    maxActiveBlasts = DEFAULT_MAX_ACTIVE_BLASTS,
    rageClickThreshold = DEFAULT_RAGE_CLICK_THRESHOLD,
    rageClickWindowMs = DEFAULT_RAGE_CLICK_WINDOW_MS,
    rageClickRadiusPx = DEFAULT_RAGE_CLICK_RADIUS_PX,
    containerRef
  } = {}) {
    const [blasts, setBlasts] = (0, import_react18.useState)([]);
    const [mounted, setMounted] = (0, import_react18.useState)(false);
    const idCounterRef = (0, import_react18.useRef)(0);
    const timeoutIdsRef = (0, import_react18.useRef)(/* @__PURE__ */ new Map());
    const recentClicksRef = (0, import_react18.useRef)([]);
    const configRef = (0, import_react18.useRef)({
      blastLifetimeMs,
      maxActiveBlasts,
      rageClickThreshold,
      rageClickWindowMs,
      rageClickRadiusPx
    });
    configRef.current = {
      blastLifetimeMs,
      maxActiveBlasts,
      rageClickThreshold,
      rageClickWindowMs,
      rageClickRadiusPx
    };
    (0, import_react18.useEffect)(() => {
      setMounted(true);
    }, []);
    (0, import_react18.useEffect)(() => {
      const removeBlast = (id) => {
        setBlasts((prev) => prev.filter((blast) => blast.id !== id));
        const timeoutId = timeoutIdsRef.current.get(id);
        if (timeoutId !== void 0) {
          window.clearTimeout(timeoutId);
          timeoutIdsRef.current.delete(id);
        }
      };
      const spawnBlast = (x, y) => {
        const cfg = configRef.current;
        const nextId = idCounterRef.current;
        idCounterRef.current += 1;
        const nextBlast = {
          id: nextId,
          x,
          y,
          size: 44 + Math.random() * 20,
          hue: 185 + Math.random() * 35
        };
        setBlasts((prev) => {
          const next = [...prev, nextBlast];
          if (next.length <= cfg.maxActiveBlasts) {
            return next;
          }
          return next.slice(next.length - cfg.maxActiveBlasts);
        });
        const timeoutId = window.setTimeout(() => removeBlast(nextId), cfg.blastLifetimeMs);
        timeoutIdsRef.current.set(nextId, timeoutId);
      };
      const onClick = (event) => {
        const cfg = configRef.current;
        const now = performance.now();
        let x;
        let y;
        if (containerRef?.current) {
          const rect = containerRef.current.getBoundingClientRect();
          x = event.clientX - rect.left;
          y = event.clientY - rect.top;
        } else {
          x = event.clientX;
          y = event.clientY;
        }
        recentClicksRef.current = recentClicksRef.current.filter(
          (click) => now - click.time < cfg.rageClickWindowMs
        );
        recentClicksRef.current.push({ time: now, x, y });
        const nearbyCount = recentClicksRef.current.filter((click) => {
          const dx = click.x - x;
          const dy = click.y - y;
          return Math.sqrt(dx * dx + dy * dy) <= cfg.rageClickRadiusPx;
        }).length;
        if (nearbyCount >= cfg.rageClickThreshold) {
          spawnBlast(x, y);
        }
      };
      const target = containerRef?.current ?? window;
      const timeoutIds = timeoutIdsRef.current;
      target.addEventListener("click", onClick);
      return () => {
        target.removeEventListener("click", onClick);
        for (const timeoutId of timeoutIds.values()) {
          window.clearTimeout(timeoutId);
        }
        timeoutIds.clear();
      };
    }, [containerRef]);
    if (!mounted) {
      return null;
    }
    const blastElements = /* @__PURE__ */ jsxs(Fragment8, { children: [
      blasts.map((blast) => /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            position: "absolute",
            left: blast.x,
            top: blast.y,
            width: blast.size,
            height: blast.size,
            transform: "translate(-50%, -50%)",
            willChange: "transform, opacity",
            filter: `hue-rotate(${blast.hue}deg)`
          },
          children: [
            /* @__PURE__ */ jsx("span", { className: "cursor-blast-ring" }),
            /* @__PURE__ */ jsx("span", { className: "cursor-blast-core" }),
            Array.from({ length: 10 }).map((_, index3) => {
              const angle = 360 / 10 * index3;
              return /* @__PURE__ */ jsx(
                "span",
                {
                  className: "cursor-blast-shard-wrap",
                  style: {
                    transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                    animationDelay: `${index3 * 16}ms`
                  },
                  children: /* @__PURE__ */ jsx("span", { className: "cursor-blast-shard" })
                },
                `${blast.id}-${index3}`
              );
            })
          ]
        },
        blast.id
      )),
      /* @__PURE__ */ jsx("style", { dangerouslySetInnerHTML: { __html: `
        .cursor-blast-ring {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          border: 2px solid hsl(197 98% 67% / 0.9);
          box-shadow:
            0 0 22px hsl(191 100% 72% / 0.6),
            inset 0 0 12px hsl(204 100% 77% / 0.65);
          animation: blast-ring 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .cursor-blast-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          transform: translate(-50%, -50%);
          background: hsl(196 100% 85%);
          box-shadow:
            0 0 26px hsl(193 100% 72% / 0.9),
            0 0 10px hsl(201 100% 85% / 0.9);
          animation: blast-core 420ms ease-out forwards;
        }

        .cursor-blast-shard-wrap {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 0;
          height: 0;
        }

        .cursor-blast-shard {
          position: absolute;
          left: 0;
          top: -1.5px;
          width: 12px;
          height: 3px;
          border-radius: 999px;
          background: linear-gradient(90deg, hsl(190 100% 84%), hsl(197 98% 67%));
          box-shadow: 0 0 12px hsl(195 100% 70% / 0.8);
          animation: blast-shard 680ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        @keyframes blast-ring {
          0% {
            transform: scale(0.2);
            opacity: 0.95;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }

        @keyframes blast-core {
          0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.2);
            opacity: 0;
          }
        }

        @keyframes blast-shard {
          0% {
            transform: translateX(0) scaleX(0.7);
            opacity: 1;
          }
          100% {
            transform: translateX(46px) scaleX(1.1);
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .cursor-blast-ring,
          .cursor-blast-core,
          .cursor-blast-shard {
            animation-duration: 1ms;
          }
        }
      ` } })
    ] });
    if (containerRef) {
      return /* @__PURE__ */ jsx(
        "div",
        {
          "aria-hidden": true,
          style: {
            position: "absolute",
            inset: 0,
            zIndex: 2147483647,
            pointerEvents: "none",
            overflow: "hidden",
            borderRadius: "inherit"
          },
          children: blastElements
        }
      );
    }
    return (0, import_react_dom3.createPortal)(
      /* @__PURE__ */ jsx(
        "div",
        {
          "aria-hidden": true,
          style: {
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            pointerEvents: "none"
          },
          children: blastElements
        }
      ),
      document.body
    );
  }

  // src/components/edit-mode.tsx
  var import_react19 = __toESM(require_react());
  var DesignEditModeContext = (0, import_react19.createContext)(false);
  function DesignEditMode({ children }) {
    return /* @__PURE__ */ jsx(DesignEditModeContext.Provider, { value: true, children });
  }
  function useDesignEditMode() {
    return (0, import_react19.useContext)(DesignEditModeContext);
  }

  // src/components/input.tsx
  var DesignInput = forwardRefIfNeeded(
    ({ className, type, prefixItem, leadingIcon, size: size5 = "md", ...props }, ref) => {
      const sizeClasses2 = size5 === "sm" ? "h-7 px-2 text-xs" : size5 === "lg" ? "h-10 px-4 text-sm" : "h-9 px-3 text-sm";
      const baseClasses = cn(
        "stack-scope flex w-full rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-white/80 dark:bg-foreground/[0.03] shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-all duration-150 hover:transition-none hover:bg-white dark:hover:bg-foreground/[0.06]",
        sizeClasses2
      );
      if (prefixItem) {
        return /* @__PURE__ */ jsxs("div", { className: "flex flex-row items-center flex-1 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-white/80 dark:bg-foreground/[0.03] shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06] overflow-hidden transition-all duration-150 hover:transition-none hover:bg-white dark:hover:bg-foreground/[0.06] focus-within:ring-1 focus-within:ring-foreground/[0.1]", children: [
          /* @__PURE__ */ jsx("div", { className: cn(
            "flex self-stretch items-center justify-center select-none text-muted-foreground/70 border-r border-black/[0.06] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02]",
            size5 === "sm" ? "px-2.5 text-xs" : size5 === "lg" ? "px-3.5 text-sm" : "px-3 text-sm"
          ), children: prefixItem }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type,
              className: cn(
                "stack-scope flex w-full bg-transparent",
                "file:border-0 file:bg-transparent file:text-sm file:font-medium",
                "placeholder:text-muted-foreground/50 focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
                sizeClasses2,
                "rounded-none border-0 shadow-none ring-0 focus-visible:ring-0",
                className
              ),
              ref,
              ...props
            }
          )
        ] });
      }
      if (leadingIcon) {
        return /* @__PURE__ */ jsxs("div", { className: "relative flex flex-row items-center flex-1", children: [
          /* @__PURE__ */ jsx("div", { className: "pointer-events-none absolute left-2.5 flex items-center text-muted-foreground", children: leadingIcon }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type,
              className: cn(baseClasses, "pl-8", className),
              ref,
              ...props
            }
          )
        ] });
      }
      return /* @__PURE__ */ jsx("div", { className: "flex flex-row items-center flex-1", children: /* @__PURE__ */ jsx(
        "input",
        {
          type,
          className: cn(baseClasses, className),
          ref,
          ...props
        }
      ) });
    }
  );
  DesignInput.displayName = "DesignInput";

  // src/components/pill-toggle.tsx
  var import_react22 = __toESM(require_react());

  // ../../node_modules/.pnpm/@radix-ui+react-tooltip@1.2.8_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-tooltip/dist/index.mjs
  var React55 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-context@1.1.2_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-context/dist/index.mjs
  var React39 = __toESM(require_react(), 1);
  function createContextScope3(scopeName, createContextScopeDeps = []) {
    let defaultContexts = [];
    function createContext32(rootComponentName, defaultContext) {
      const BaseContext = React39.createContext(defaultContext);
      const index3 = defaultContexts.length;
      defaultContexts = [...defaultContexts, defaultContext];
      const Provider2 = (props) => {
        const { scope, children, ...context } = props;
        const Context = scope?.[scopeName]?.[index3] || BaseContext;
        const value = React39.useMemo(() => context, Object.values(context));
        return /* @__PURE__ */ jsx(Context.Provider, { value, children });
      };
      Provider2.displayName = rootComponentName + "Provider";
      function useContext22(consumerName, scope) {
        const Context = scope?.[scopeName]?.[index3] || BaseContext;
        const context = React39.useContext(Context);
        if (context) return context;
        if (defaultContext !== void 0) return defaultContext;
        throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
      }
      return [Provider2, useContext22];
    }
    const createScope = () => {
      const scopeContexts = defaultContexts.map((defaultContext) => {
        return React39.createContext(defaultContext);
      });
      return function useScope(scope) {
        const contexts = scope?.[scopeName] || scopeContexts;
        return React39.useMemo(
          () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
          [scope, contexts]
        );
      };
    };
    createScope.scopeName = scopeName;
    return [createContext32, composeContextScopes3(createScope, ...createContextScopeDeps)];
  }
  function composeContextScopes3(...scopes) {
    const baseScope = scopes[0];
    if (scopes.length === 1) return baseScope;
    const createScope = () => {
      const scopeHooks = scopes.map((createScope2) => ({
        useScope: createScope2(),
        scopeName: createScope2.scopeName
      }));
      return function useComposedScopes(overrideScopes) {
        const nextScopes = scopeHooks.reduce((nextScopes2, { useScope, scopeName }) => {
          const scopeProps = useScope(overrideScopes);
          const currentScope = scopeProps[`__scope${scopeName}`];
          return { ...nextScopes2, ...currentScope };
        }, {});
        return React39.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
      };
    };
    createScope.scopeName = baseScope.scopeName;
    return createScope;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-dismissable-layer@1.1.11_@types+react-dom@18.3.1_@types+react@18.3.12_r_e4093f5981aea34e35803c4408f783d9/node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
  var React44 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-primitive@2.1.3_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-primitive/dist/index.mjs
  var React41 = __toESM(require_react(), 1);
  var ReactDOM4 = __toESM(require_react_dom(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-slot@1.2.3_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-slot/dist/index.mjs
  var React40 = __toESM(require_react(), 1);
  // @__NO_SIDE_EFFECTS__
  function createSlot2(ownerName) {
    const SlotClone2 = /* @__PURE__ */ createSlotClone2(ownerName);
    const Slot22 = React40.forwardRef((props, forwardedRef) => {
      const { children, ...slotProps } = props;
      const childrenArray = React40.Children.toArray(children);
      const slottable = childrenArray.find(isSlottable3);
      if (slottable) {
        const newElement = slottable.props.children;
        const newChildren = childrenArray.map((child) => {
          if (child === slottable) {
            if (React40.Children.count(newElement) > 1) return React40.Children.only(null);
            return React40.isValidElement(newElement) ? newElement.props.children : null;
          } else {
            return child;
          }
        });
        return /* @__PURE__ */ jsx(SlotClone2, { ...slotProps, ref: forwardedRef, children: React40.isValidElement(newElement) ? React40.cloneElement(newElement, void 0, newChildren) : null });
      }
      return /* @__PURE__ */ jsx(SlotClone2, { ...slotProps, ref: forwardedRef, children });
    });
    Slot22.displayName = `${ownerName}.Slot`;
    return Slot22;
  }
  // @__NO_SIDE_EFFECTS__
  function createSlotClone2(ownerName) {
    const SlotClone2 = React40.forwardRef((props, forwardedRef) => {
      const { children, ...slotProps } = props;
      if (React40.isValidElement(children)) {
        const childrenRef = getElementRef4(children);
        const props2 = mergeProps3(slotProps, children.props);
        if (children.type !== React40.Fragment) {
          props2.ref = forwardedRef ? composeRefs2(forwardedRef, childrenRef) : childrenRef;
        }
        return React40.cloneElement(children, props2);
      }
      return React40.Children.count(children) > 1 ? React40.Children.only(null) : null;
    });
    SlotClone2.displayName = `${ownerName}.SlotClone`;
    return SlotClone2;
  }
  var SLOTTABLE_IDENTIFIER2 = Symbol("radix.slottable");
  // @__NO_SIDE_EFFECTS__
  function createSlottable2(ownerName) {
    const Slottable22 = ({ children }) => {
      return /* @__PURE__ */ jsx(Fragment8, { children });
    };
    Slottable22.displayName = `${ownerName}.Slottable`;
    Slottable22.__radixId = SLOTTABLE_IDENTIFIER2;
    return Slottable22;
  }
  function isSlottable3(child) {
    return React40.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER2;
  }
  function mergeProps3(slotProps, childProps) {
    const overrideProps = { ...childProps };
    for (const propName in childProps) {
      const slotPropValue = slotProps[propName];
      const childPropValue = childProps[propName];
      const isHandler = /^on[A-Z]/.test(propName);
      if (isHandler) {
        if (slotPropValue && childPropValue) {
          overrideProps[propName] = (...args) => {
            const result = childPropValue(...args);
            slotPropValue(...args);
            return result;
          };
        } else if (slotPropValue) {
          overrideProps[propName] = slotPropValue;
        }
      } else if (propName === "style") {
        overrideProps[propName] = { ...slotPropValue, ...childPropValue };
      } else if (propName === "className") {
        overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
      }
    }
    return { ...slotProps, ...overrideProps };
  }
  function getElementRef4(element) {
    let getter2 = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
    let mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.ref;
    }
    getter2 = Object.getOwnPropertyDescriptor(element, "ref")?.get;
    mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.props.ref;
    }
    return element.props.ref || element.ref;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-primitive@2.1.3_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-primitive/dist/index.mjs
  var NODES2 = [
    "a",
    "button",
    "div",
    "form",
    "h2",
    "h3",
    "img",
    "input",
    "label",
    "li",
    "nav",
    "ol",
    "p",
    "select",
    "span",
    "svg",
    "ul"
  ];
  var Primitive2 = NODES2.reduce((primitive, node) => {
    const Slot3 = createSlot2(`Primitive.${node}`);
    const Node2 = React41.forwardRef((props, forwardedRef) => {
      const { asChild, ...primitiveProps } = props;
      const Comp = asChild ? Slot3 : node;
      if (typeof window !== "undefined") {
        window[Symbol.for("radix-ui")] = true;
      }
      return /* @__PURE__ */ jsx(Comp, { ...primitiveProps, ref: forwardedRef });
    });
    Node2.displayName = `Primitive.${node}`;
    return { ...primitive, [node]: Node2 };
  }, {});
  function dispatchDiscreteCustomEvent2(target, event) {
    if (target) ReactDOM4.flushSync(() => target.dispatchEvent(event));
  }

  // ../../node_modules/.pnpm/@radix-ui+react-use-callback-ref@1.1.1_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
  var React42 = __toESM(require_react(), 1);
  function useCallbackRef3(callback) {
    const callbackRef = React42.useRef(callback);
    React42.useEffect(() => {
      callbackRef.current = callback;
    });
    return React42.useMemo(() => (...args) => callbackRef.current?.(...args), []);
  }

  // ../../node_modules/.pnpm/@radix-ui+react-use-escape-keydown@1.1.1_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-use-escape-keydown/dist/index.mjs
  var React43 = __toESM(require_react(), 1);
  function useEscapeKeydown2(onEscapeKeyDownProp, ownerDocument = globalThis?.document) {
    const onEscapeKeyDown = useCallbackRef3(onEscapeKeyDownProp);
    React43.useEffect(() => {
      const handleKeyDown = (event) => {
        if (event.key === "Escape") {
          onEscapeKeyDown(event);
        }
      };
      ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => ownerDocument.removeEventListener("keydown", handleKeyDown, { capture: true });
    }, [onEscapeKeyDown, ownerDocument]);
  }

  // ../../node_modules/.pnpm/@radix-ui+react-dismissable-layer@1.1.11_@types+react-dom@18.3.1_@types+react@18.3.12_r_e4093f5981aea34e35803c4408f783d9/node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
  var DISMISSABLE_LAYER_NAME2 = "DismissableLayer";
  var CONTEXT_UPDATE2 = "dismissableLayer.update";
  var POINTER_DOWN_OUTSIDE2 = "dismissableLayer.pointerDownOutside";
  var FOCUS_OUTSIDE2 = "dismissableLayer.focusOutside";
  var originalBodyPointerEvents2;
  var DismissableLayerContext2 = React44.createContext({
    layers: /* @__PURE__ */ new Set(),
    layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
    branches: /* @__PURE__ */ new Set()
  });
  var DismissableLayer2 = React44.forwardRef(
    (props, forwardedRef) => {
      const {
        disableOutsidePointerEvents = false,
        onEscapeKeyDown,
        onPointerDownOutside,
        onFocusOutside,
        onInteractOutside,
        onDismiss,
        ...layerProps
      } = props;
      const context = React44.useContext(DismissableLayerContext2);
      const [node, setNode] = React44.useState(null);
      const ownerDocument = node?.ownerDocument ?? globalThis?.document;
      const [, force] = React44.useState({});
      const composedRefs = useComposedRefs2(forwardedRef, (node2) => setNode(node2));
      const layers = Array.from(context.layers);
      const [highestLayerWithOutsidePointerEventsDisabled] = [...context.layersWithOutsidePointerEventsDisabled].slice(-1);
      const highestLayerWithOutsidePointerEventsDisabledIndex = layers.indexOf(highestLayerWithOutsidePointerEventsDisabled);
      const index3 = node ? layers.indexOf(node) : -1;
      const isBodyPointerEventsDisabled = context.layersWithOutsidePointerEventsDisabled.size > 0;
      const isPointerEventsEnabled = index3 >= highestLayerWithOutsidePointerEventsDisabledIndex;
      const pointerDownOutside = usePointerDownOutside2((event) => {
        const target = event.target;
        const isPointerDownOnBranch = [...context.branches].some((branch) => branch.contains(target));
        if (!isPointerEventsEnabled || isPointerDownOnBranch) return;
        onPointerDownOutside?.(event);
        onInteractOutside?.(event);
        if (!event.defaultPrevented) onDismiss?.();
      }, ownerDocument);
      const focusOutside = useFocusOutside2((event) => {
        const target = event.target;
        const isFocusInBranch = [...context.branches].some((branch) => branch.contains(target));
        if (isFocusInBranch) return;
        onFocusOutside?.(event);
        onInteractOutside?.(event);
        if (!event.defaultPrevented) onDismiss?.();
      }, ownerDocument);
      useEscapeKeydown2((event) => {
        const isHighestLayer = index3 === context.layers.size - 1;
        if (!isHighestLayer) return;
        onEscapeKeyDown?.(event);
        if (!event.defaultPrevented && onDismiss) {
          event.preventDefault();
          onDismiss();
        }
      }, ownerDocument);
      React44.useEffect(() => {
        if (!node) return;
        if (disableOutsidePointerEvents) {
          if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
            originalBodyPointerEvents2 = ownerDocument.body.style.pointerEvents;
            ownerDocument.body.style.pointerEvents = "none";
          }
          context.layersWithOutsidePointerEventsDisabled.add(node);
        }
        context.layers.add(node);
        dispatchUpdate2();
        return () => {
          if (disableOutsidePointerEvents && context.layersWithOutsidePointerEventsDisabled.size === 1) {
            ownerDocument.body.style.pointerEvents = originalBodyPointerEvents2;
          }
        };
      }, [node, ownerDocument, disableOutsidePointerEvents, context]);
      React44.useEffect(() => {
        return () => {
          if (!node) return;
          context.layers.delete(node);
          context.layersWithOutsidePointerEventsDisabled.delete(node);
          dispatchUpdate2();
        };
      }, [node, context]);
      React44.useEffect(() => {
        const handleUpdate = () => force({});
        document.addEventListener(CONTEXT_UPDATE2, handleUpdate);
        return () => document.removeEventListener(CONTEXT_UPDATE2, handleUpdate);
      }, []);
      return /* @__PURE__ */ jsx(
        Primitive2.div,
        {
          ...layerProps,
          ref: composedRefs,
          style: {
            pointerEvents: isBodyPointerEventsDisabled ? isPointerEventsEnabled ? "auto" : "none" : void 0,
            ...props.style
          },
          onFocusCapture: composeEventHandlers2(props.onFocusCapture, focusOutside.onFocusCapture),
          onBlurCapture: composeEventHandlers2(props.onBlurCapture, focusOutside.onBlurCapture),
          onPointerDownCapture: composeEventHandlers2(
            props.onPointerDownCapture,
            pointerDownOutside.onPointerDownCapture
          )
        }
      );
    }
  );
  DismissableLayer2.displayName = DISMISSABLE_LAYER_NAME2;
  var BRANCH_NAME2 = "DismissableLayerBranch";
  var DismissableLayerBranch2 = React44.forwardRef((props, forwardedRef) => {
    const context = React44.useContext(DismissableLayerContext2);
    const ref = React44.useRef(null);
    const composedRefs = useComposedRefs2(forwardedRef, ref);
    React44.useEffect(() => {
      const node = ref.current;
      if (node) {
        context.branches.add(node);
        return () => {
          context.branches.delete(node);
        };
      }
    }, [context.branches]);
    return /* @__PURE__ */ jsx(Primitive2.div, { ...props, ref: composedRefs });
  });
  DismissableLayerBranch2.displayName = BRANCH_NAME2;
  function usePointerDownOutside2(onPointerDownOutside, ownerDocument = globalThis?.document) {
    const handlePointerDownOutside = useCallbackRef3(onPointerDownOutside);
    const isPointerInsideReactTreeRef = React44.useRef(false);
    const handleClickRef = React44.useRef(() => {
    });
    React44.useEffect(() => {
      const handlePointerDown = (event) => {
        if (event.target && !isPointerInsideReactTreeRef.current) {
          let handleAndDispatchPointerDownOutsideEvent2 = function() {
            handleAndDispatchCustomEvent2(
              POINTER_DOWN_OUTSIDE2,
              handlePointerDownOutside,
              eventDetail,
              { discrete: true }
            );
          };
          var handleAndDispatchPointerDownOutsideEvent = handleAndDispatchPointerDownOutsideEvent2;
          const eventDetail = { originalEvent: event };
          if (event.pointerType === "touch") {
            ownerDocument.removeEventListener("click", handleClickRef.current);
            handleClickRef.current = handleAndDispatchPointerDownOutsideEvent2;
            ownerDocument.addEventListener("click", handleClickRef.current, { once: true });
          } else {
            handleAndDispatchPointerDownOutsideEvent2();
          }
        } else {
          ownerDocument.removeEventListener("click", handleClickRef.current);
        }
        isPointerInsideReactTreeRef.current = false;
      };
      const timerId = window.setTimeout(() => {
        ownerDocument.addEventListener("pointerdown", handlePointerDown);
      }, 0);
      return () => {
        window.clearTimeout(timerId);
        ownerDocument.removeEventListener("pointerdown", handlePointerDown);
        ownerDocument.removeEventListener("click", handleClickRef.current);
      };
    }, [ownerDocument, handlePointerDownOutside]);
    return {
      // ensures we check React component tree (not just DOM tree)
      onPointerDownCapture: () => isPointerInsideReactTreeRef.current = true
    };
  }
  function useFocusOutside2(onFocusOutside, ownerDocument = globalThis?.document) {
    const handleFocusOutside = useCallbackRef3(onFocusOutside);
    const isFocusInsideReactTreeRef = React44.useRef(false);
    React44.useEffect(() => {
      const handleFocus = (event) => {
        if (event.target && !isFocusInsideReactTreeRef.current) {
          const eventDetail = { originalEvent: event };
          handleAndDispatchCustomEvent2(FOCUS_OUTSIDE2, handleFocusOutside, eventDetail, {
            discrete: false
          });
        }
      };
      ownerDocument.addEventListener("focusin", handleFocus);
      return () => ownerDocument.removeEventListener("focusin", handleFocus);
    }, [ownerDocument, handleFocusOutside]);
    return {
      onFocusCapture: () => isFocusInsideReactTreeRef.current = true,
      onBlurCapture: () => isFocusInsideReactTreeRef.current = false
    };
  }
  function dispatchUpdate2() {
    const event = new CustomEvent(CONTEXT_UPDATE2);
    document.dispatchEvent(event);
  }
  function handleAndDispatchCustomEvent2(name, handler, detail, { discrete }) {
    const target = detail.originalEvent.target;
    const event = new CustomEvent(name, { bubbles: false, cancelable: true, detail });
    if (handler) target.addEventListener(name, handler, { once: true });
    if (discrete) {
      dispatchDiscreteCustomEvent2(target, event);
    } else {
      target.dispatchEvent(event);
    }
  }

  // ../../node_modules/.pnpm/@radix-ui+react-id@1.1.1_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-id/dist/index.mjs
  var React46 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@radix-ui+react-use-layout-effect@1.1.1_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
  var React45 = __toESM(require_react(), 1);
  var useLayoutEffect22 = globalThis?.document ? React45.useLayoutEffect : () => {
  };

  // ../../node_modules/.pnpm/@radix-ui+react-id@1.1.1_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-id/dist/index.mjs
  var useReactId2 = React46[" useId ".trim().toString()] || (() => void 0);
  var count3 = 0;
  function useId2(deterministicId) {
    const [id, setId] = React46.useState(useReactId2());
    useLayoutEffect22(() => {
      if (!deterministicId) setId((reactId) => reactId ?? String(count3++));
    }, [deterministicId]);
    return deterministicId || (id ? `radix-${id}` : "");
  }

  // ../../node_modules/.pnpm/@radix-ui+react-popper@1.2.8_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-popper/dist/index.mjs
  var React50 = __toESM(require_react(), 1);

  // ../../node_modules/.pnpm/@floating-ui+react-dom@2.1.2_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@floating-ui/react-dom/dist/floating-ui.react-dom.mjs
  var React47 = __toESM(require_react(), 1);
  var import_react21 = __toESM(require_react(), 1);
  var ReactDOM5 = __toESM(require_react_dom(), 1);
  var index2 = typeof document !== "undefined" ? import_react21.useLayoutEffect : import_react21.useEffect;
  function deepEqual2(a8, b) {
    if (a8 === b) {
      return true;
    }
    if (typeof a8 !== typeof b) {
      return false;
    }
    if (typeof a8 === "function" && a8.toString() === b.toString()) {
      return true;
    }
    let length;
    let i;
    let keys;
    if (a8 && b && typeof a8 === "object") {
      if (Array.isArray(a8)) {
        length = a8.length;
        if (length !== b.length) return false;
        for (i = length; i-- !== 0; ) {
          if (!deepEqual2(a8[i], b[i])) {
            return false;
          }
        }
        return true;
      }
      keys = Object.keys(a8);
      length = keys.length;
      if (length !== Object.keys(b).length) {
        return false;
      }
      for (i = length; i-- !== 0; ) {
        if (!{}.hasOwnProperty.call(b, keys[i])) {
          return false;
        }
      }
      for (i = length; i-- !== 0; ) {
        const key = keys[i];
        if (key === "_owner" && a8.$$typeof) {
          continue;
        }
        if (!deepEqual2(a8[key], b[key])) {
          return false;
        }
      }
      return true;
    }
    return a8 !== a8 && b !== b;
  }
  function getDPR2(element) {
    if (typeof window === "undefined") {
      return 1;
    }
    const win = element.ownerDocument.defaultView || window;
    return win.devicePixelRatio || 1;
  }
  function roundByDPR2(element, value) {
    const dpr = getDPR2(element);
    return Math.round(value * dpr) / dpr;
  }
  function useLatestRef2(value) {
    const ref = React47.useRef(value);
    index2(() => {
      ref.current = value;
    });
    return ref;
  }
  function useFloating2(options) {
    if (options === void 0) {
      options = {};
    }
    const {
      placement = "bottom",
      strategy = "absolute",
      middleware = [],
      platform: platform2,
      elements: {
        reference: externalReference,
        floating: externalFloating
      } = {},
      transform = true,
      whileElementsMounted,
      open
    } = options;
    const [data, setData] = React47.useState({
      x: 0,
      y: 0,
      strategy,
      placement,
      middlewareData: {},
      isPositioned: false
    });
    const [latestMiddleware, setLatestMiddleware] = React47.useState(middleware);
    if (!deepEqual2(latestMiddleware, middleware)) {
      setLatestMiddleware(middleware);
    }
    const [_reference, _setReference] = React47.useState(null);
    const [_floating, _setFloating] = React47.useState(null);
    const setReference = React47.useCallback((node) => {
      if (node !== referenceRef.current) {
        referenceRef.current = node;
        _setReference(node);
      }
    }, []);
    const setFloating = React47.useCallback((node) => {
      if (node !== floatingRef.current) {
        floatingRef.current = node;
        _setFloating(node);
      }
    }, []);
    const referenceEl = externalReference || _reference;
    const floatingEl = externalFloating || _floating;
    const referenceRef = React47.useRef(null);
    const floatingRef = React47.useRef(null);
    const dataRef = React47.useRef(data);
    const hasWhileElementsMounted = whileElementsMounted != null;
    const whileElementsMountedRef = useLatestRef2(whileElementsMounted);
    const platformRef = useLatestRef2(platform2);
    const openRef = useLatestRef2(open);
    const update = React47.useCallback(() => {
      if (!referenceRef.current || !floatingRef.current) {
        return;
      }
      const config = {
        placement,
        strategy,
        middleware: latestMiddleware
      };
      if (platformRef.current) {
        config.platform = platformRef.current;
      }
      computePosition2(referenceRef.current, floatingRef.current, config).then((data2) => {
        const fullData = {
          ...data2,
          // The floating element's position may be recomputed while it's closed
          // but still mounted (such as when transitioning out). To ensure
          // `isPositioned` will be `false` initially on the next open, avoid
          // setting it to `true` when `open === false` (must be specified).
          isPositioned: openRef.current !== false
        };
        if (isMountedRef.current && !deepEqual2(dataRef.current, fullData)) {
          dataRef.current = fullData;
          ReactDOM5.flushSync(() => {
            setData(fullData);
          });
        }
      });
    }, [latestMiddleware, placement, strategy, platformRef, openRef]);
    index2(() => {
      if (open === false && dataRef.current.isPositioned) {
        dataRef.current.isPositioned = false;
        setData((data2) => ({
          ...data2,
          isPositioned: false
        }));
      }
    }, [open]);
    const isMountedRef = React47.useRef(false);
    index2(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
      };
    }, []);
    index2(() => {
      if (referenceEl) referenceRef.current = referenceEl;
      if (floatingEl) floatingRef.current = floatingEl;
      if (referenceEl && floatingEl) {
        if (whileElementsMountedRef.current) {
          return whileElementsMountedRef.current(referenceEl, floatingEl, update);
        }
        update();
      }
    }, [referenceEl, floatingEl, update, whileElementsMountedRef, hasWhileElementsMounted]);
    const refs = React47.useMemo(() => ({
      reference: referenceRef,
      floating: floatingRef,
      setReference,
      setFloating
    }), [setReference, setFloating]);
    const elements = React47.useMemo(() => ({
      reference: referenceEl,
      floating: floatingEl
    }), [referenceEl, floatingEl]);
    const floatingStyles = React47.useMemo(() => {
      const initialStyles = {
        position: strategy,
        left: 0,
        top: 0
      };
      if (!elements.floating) {
        return initialStyles;
      }
      const x = roundByDPR2(elements.floating, data.x);
      const y = roundByDPR2(elements.floating, data.y);
      if (transform) {
        return {
          ...initialStyles,
          transform: "translate(" + x + "px, " + y + "px)",
          ...getDPR2(elements.floating) >= 1.5 && {
            willChange: "transform"
          }
        };
      }
      return {
        position: strategy,
        left: x,
        top: y
      };
    }, [strategy, transform, elements.floating, data.x, data.y]);
    return React47.useMemo(() => ({
      ...data,
      update,
      refs,
      elements,
      floatingStyles
    }), [data, update, refs, elements, floatingStyles]);
  }
  var arrow$12 = (options) => {
    function isRef(value) {
      return {}.hasOwnProperty.call(value, "current");
    }
    return {
      name: "arrow",
      options,
      fn(state) {
        const {
          element,
          padding
        } = typeof options === "function" ? options(state) : options;
        if (element && isRef(element)) {
          if (element.current != null) {
            return arrow2({
              element: element.current,
              padding
            }).fn(state);
          }
          return {};
        }
        if (element) {
          return arrow2({
            element,
            padding
          }).fn(state);
        }
        return {};
      }
    };
  };
  var offset4 = (options, deps) => ({
    ...offset2(options),
    options: [options, deps]
  });
  var shift4 = (options, deps) => ({
    ...shift2(options),
    options: [options, deps]
  });
  var limitShift4 = (options, deps) => ({
    ...limitShift2(options),
    options: [options, deps]
  });
  var flip4 = (options, deps) => ({
    ...flip2(options),
    options: [options, deps]
  });
  var size4 = (options, deps) => ({
    ...size2(options),
    options: [options, deps]
  });
  var hide4 = (options, deps) => ({
    ...hide2(options),
    options: [options, deps]
  });
  var arrow4 = (options, deps) => ({
    ...arrow$12(options),
    options: [options, deps]
  });

  // ../../node_modules/.pnpm/@radix-ui+react-arrow@1.1.7_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-arrow/dist/index.mjs
  var React48 = __toESM(require_react(), 1);
  var NAME3 = "Arrow";
  var Arrow3 = React48.forwardRef((props, forwardedRef) => {
    const { children, width = 10, height = 5, ...arrowProps } = props;
    return /* @__PURE__ */ jsx(
      Primitive2.svg,
      {
        ...arrowProps,
        ref: forwardedRef,
        width,
        height,
        viewBox: "0 0 30 10",
        preserveAspectRatio: "none",
        children: props.asChild ? children : /* @__PURE__ */ jsx("polygon", { points: "0,0 30,0 15,10" })
      }
    );
  });
  Arrow3.displayName = NAME3;
  var Root5 = Arrow3;

  // ../../node_modules/.pnpm/@radix-ui+react-use-size@1.1.1_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-use-size/dist/index.mjs
  var React49 = __toESM(require_react(), 1);
  function useSize2(element) {
    const [size5, setSize] = React49.useState(void 0);
    useLayoutEffect22(() => {
      if (element) {
        setSize({ width: element.offsetWidth, height: element.offsetHeight });
        const resizeObserver = new ResizeObserver((entries) => {
          if (!Array.isArray(entries)) {
            return;
          }
          if (!entries.length) {
            return;
          }
          const entry = entries[0];
          let width;
          let height;
          if ("borderBoxSize" in entry) {
            const borderSizeEntry = entry["borderBoxSize"];
            const borderSize = Array.isArray(borderSizeEntry) ? borderSizeEntry[0] : borderSizeEntry;
            width = borderSize["inlineSize"];
            height = borderSize["blockSize"];
          } else {
            width = element.offsetWidth;
            height = element.offsetHeight;
          }
          setSize({ width, height });
        });
        resizeObserver.observe(element, { box: "border-box" });
        return () => resizeObserver.unobserve(element);
      } else {
        setSize(void 0);
      }
    }, [element]);
    return size5;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-popper@1.2.8_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-popper/dist/index.mjs
  var POPPER_NAME2 = "Popper";
  var [createPopperContext2, createPopperScope2] = createContextScope3(POPPER_NAME2);
  var [PopperProvider2, usePopperContext2] = createPopperContext2(POPPER_NAME2);
  var Popper2 = (props) => {
    const { __scopePopper, children } = props;
    const [anchor, setAnchor] = React50.useState(null);
    return /* @__PURE__ */ jsx(PopperProvider2, { scope: __scopePopper, anchor, onAnchorChange: setAnchor, children });
  };
  Popper2.displayName = POPPER_NAME2;
  var ANCHOR_NAME2 = "PopperAnchor";
  var PopperAnchor2 = React50.forwardRef(
    (props, forwardedRef) => {
      const { __scopePopper, virtualRef, ...anchorProps } = props;
      const context = usePopperContext2(ANCHOR_NAME2, __scopePopper);
      const ref = React50.useRef(null);
      const composedRefs = useComposedRefs2(forwardedRef, ref);
      const anchorRef = React50.useRef(null);
      React50.useEffect(() => {
        const previousAnchor = anchorRef.current;
        anchorRef.current = virtualRef?.current || ref.current;
        if (previousAnchor !== anchorRef.current) {
          context.onAnchorChange(anchorRef.current);
        }
      });
      return virtualRef ? null : /* @__PURE__ */ jsx(Primitive2.div, { ...anchorProps, ref: composedRefs });
    }
  );
  PopperAnchor2.displayName = ANCHOR_NAME2;
  var CONTENT_NAME4 = "PopperContent";
  var [PopperContentProvider2, useContentContext2] = createPopperContext2(CONTENT_NAME4);
  var PopperContent2 = React50.forwardRef(
    (props, forwardedRef) => {
      const {
        __scopePopper,
        side = "bottom",
        sideOffset = 0,
        align = "center",
        alignOffset = 0,
        arrowPadding = 0,
        avoidCollisions = true,
        collisionBoundary = [],
        collisionPadding: collisionPaddingProp = 0,
        sticky = "partial",
        hideWhenDetached = false,
        updatePositionStrategy = "optimized",
        onPlaced,
        ...contentProps
      } = props;
      const context = usePopperContext2(CONTENT_NAME4, __scopePopper);
      const [content, setContent] = React50.useState(null);
      const composedRefs = useComposedRefs2(forwardedRef, (node) => setContent(node));
      const [arrow5, setArrow] = React50.useState(null);
      const arrowSize = useSize2(arrow5);
      const arrowWidth = arrowSize?.width ?? 0;
      const arrowHeight = arrowSize?.height ?? 0;
      const desiredPlacement = side + (align !== "center" ? "-" + align : "");
      const collisionPadding = typeof collisionPaddingProp === "number" ? collisionPaddingProp : { top: 0, right: 0, bottom: 0, left: 0, ...collisionPaddingProp };
      const boundary = Array.isArray(collisionBoundary) ? collisionBoundary : [collisionBoundary];
      const hasExplicitBoundaries = boundary.length > 0;
      const detectOverflowOptions = {
        padding: collisionPadding,
        boundary: boundary.filter(isNotNull3),
        // with `strategy: 'fixed'`, this is the only way to get it to respect boundaries
        altBoundary: hasExplicitBoundaries
      };
      const { refs, floatingStyles, placement, isPositioned, middlewareData } = useFloating2({
        // default to `fixed` strategy so users don't have to pick and we also avoid focus scroll issues
        strategy: "fixed",
        placement: desiredPlacement,
        whileElementsMounted: (...args) => {
          const cleanup = autoUpdate(...args, {
            animationFrame: updatePositionStrategy === "always"
          });
          return cleanup;
        },
        elements: {
          reference: context.anchor
        },
        middleware: [
          offset4({ mainAxis: sideOffset + arrowHeight, alignmentAxis: alignOffset }),
          avoidCollisions && shift4({
            mainAxis: true,
            crossAxis: false,
            limiter: sticky === "partial" ? limitShift4() : void 0,
            ...detectOverflowOptions
          }),
          avoidCollisions && flip4({ ...detectOverflowOptions }),
          size4({
            ...detectOverflowOptions,
            apply: ({ elements, rects, availableWidth, availableHeight }) => {
              const { width: anchorWidth, height: anchorHeight } = rects.reference;
              const contentStyle = elements.floating.style;
              contentStyle.setProperty("--radix-popper-available-width", `${availableWidth}px`);
              contentStyle.setProperty("--radix-popper-available-height", `${availableHeight}px`);
              contentStyle.setProperty("--radix-popper-anchor-width", `${anchorWidth}px`);
              contentStyle.setProperty("--radix-popper-anchor-height", `${anchorHeight}px`);
            }
          }),
          arrow5 && arrow4({ element: arrow5, padding: arrowPadding }),
          transformOrigin2({ arrowWidth, arrowHeight }),
          hideWhenDetached && hide4({ strategy: "referenceHidden", ...detectOverflowOptions })
        ]
      });
      const [placedSide, placedAlign] = getSideAndAlignFromPlacement2(placement);
      const handlePlaced = useCallbackRef3(onPlaced);
      useLayoutEffect22(() => {
        if (isPositioned) {
          handlePlaced?.();
        }
      }, [isPositioned, handlePlaced]);
      const arrowX = middlewareData.arrow?.x;
      const arrowY = middlewareData.arrow?.y;
      const cannotCenterArrow = middlewareData.arrow?.centerOffset !== 0;
      const [contentZIndex, setContentZIndex] = React50.useState();
      useLayoutEffect22(() => {
        if (content) setContentZIndex(window.getComputedStyle(content).zIndex);
      }, [content]);
      return /* @__PURE__ */ jsx(
        "div",
        {
          ref: refs.setFloating,
          "data-radix-popper-content-wrapper": "",
          style: {
            ...floatingStyles,
            transform: isPositioned ? floatingStyles.transform : "translate(0, -200%)",
            // keep off the page when measuring
            minWidth: "max-content",
            zIndex: contentZIndex,
            ["--radix-popper-transform-origin"]: [
              middlewareData.transformOrigin?.x,
              middlewareData.transformOrigin?.y
            ].join(" "),
            // hide the content if using the hide middleware and should be hidden
            // set visibility to hidden and disable pointer events so the UI behaves
            // as if the PopperContent isn't there at all
            ...middlewareData.hide?.referenceHidden && {
              visibility: "hidden",
              pointerEvents: "none"
            }
          },
          dir: props.dir,
          children: /* @__PURE__ */ jsx(
            PopperContentProvider2,
            {
              scope: __scopePopper,
              placedSide,
              onArrowChange: setArrow,
              arrowX,
              arrowY,
              shouldHideArrow: cannotCenterArrow,
              children: /* @__PURE__ */ jsx(
                Primitive2.div,
                {
                  "data-side": placedSide,
                  "data-align": placedAlign,
                  ...contentProps,
                  ref: composedRefs,
                  style: {
                    ...contentProps.style,
                    // if the PopperContent hasn't been placed yet (not all measurements done)
                    // we prevent animations so that users's animation don't kick in too early referring wrong sides
                    animation: !isPositioned ? "none" : void 0
                  }
                }
              )
            }
          )
        }
      );
    }
  );
  PopperContent2.displayName = CONTENT_NAME4;
  var ARROW_NAME3 = "PopperArrow";
  var OPPOSITE_SIDE2 = {
    top: "bottom",
    right: "left",
    bottom: "top",
    left: "right"
  };
  var PopperArrow3 = React50.forwardRef(function PopperArrow22(props, forwardedRef) {
    const { __scopePopper, ...arrowProps } = props;
    const contentContext = useContentContext2(ARROW_NAME3, __scopePopper);
    const baseSide = OPPOSITE_SIDE2[contentContext.placedSide];
    return (
      // we have to use an extra wrapper because `ResizeObserver` (used by `useSize`)
      // doesn't report size as we'd expect on SVG elements.
      // it reports their bounding box which is effectively the largest path inside the SVG.
      /* @__PURE__ */ jsx(
        "span",
        {
          ref: contentContext.onArrowChange,
          style: {
            position: "absolute",
            left: contentContext.arrowX,
            top: contentContext.arrowY,
            [baseSide]: 0,
            transformOrigin: {
              top: "",
              right: "0 0",
              bottom: "center 0",
              left: "100% 0"
            }[contentContext.placedSide],
            transform: {
              top: "translateY(100%)",
              right: "translateY(50%) rotate(90deg) translateX(-50%)",
              bottom: `rotate(180deg)`,
              left: "translateY(50%) rotate(-90deg) translateX(50%)"
            }[contentContext.placedSide],
            visibility: contentContext.shouldHideArrow ? "hidden" : void 0
          },
          children: /* @__PURE__ */ jsx(
            Root5,
            {
              ...arrowProps,
              ref: forwardedRef,
              style: {
                ...arrowProps.style,
                // ensures the element can be measured correctly (mostly for if SVG)
                display: "block"
              }
            }
          )
        }
      )
    );
  });
  PopperArrow3.displayName = ARROW_NAME3;
  function isNotNull3(value) {
    return value !== null;
  }
  var transformOrigin2 = (options) => ({
    name: "transformOrigin",
    options,
    fn(data) {
      const { placement, rects, middlewareData } = data;
      const cannotCenterArrow = middlewareData.arrow?.centerOffset !== 0;
      const isArrowHidden = cannotCenterArrow;
      const arrowWidth = isArrowHidden ? 0 : options.arrowWidth;
      const arrowHeight = isArrowHidden ? 0 : options.arrowHeight;
      const [placedSide, placedAlign] = getSideAndAlignFromPlacement2(placement);
      const noArrowAlign = { start: "0%", center: "50%", end: "100%" }[placedAlign];
      const arrowXCenter = (middlewareData.arrow?.x ?? 0) + arrowWidth / 2;
      const arrowYCenter = (middlewareData.arrow?.y ?? 0) + arrowHeight / 2;
      let x = "";
      let y = "";
      if (placedSide === "bottom") {
        x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
        y = `${-arrowHeight}px`;
      } else if (placedSide === "top") {
        x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
        y = `${rects.floating.height + arrowHeight}px`;
      } else if (placedSide === "right") {
        x = `${-arrowHeight}px`;
        y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
      } else if (placedSide === "left") {
        x = `${rects.floating.width + arrowHeight}px`;
        y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
      }
      return { data: { x, y } };
    }
  });
  function getSideAndAlignFromPlacement2(placement) {
    const [side, align = "center"] = placement.split("-");
    return [side, align];
  }
  var Root22 = Popper2;
  var Anchor2 = PopperAnchor2;
  var Content3 = PopperContent2;
  var Arrow4 = PopperArrow3;

  // ../../node_modules/.pnpm/@radix-ui+react-portal@1.1.9_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-portal/dist/index.mjs
  var React51 = __toESM(require_react(), 1);
  var import_react_dom5 = __toESM(require_react_dom(), 1);
  var PORTAL_NAME4 = "Portal";
  var Portal3 = React51.forwardRef((props, forwardedRef) => {
    const { container: containerProp, ...portalProps } = props;
    const [mounted, setMounted] = React51.useState(false);
    useLayoutEffect22(() => setMounted(true), []);
    const container = containerProp || mounted && globalThis?.document?.body;
    return container ? import_react_dom5.default.createPortal(/* @__PURE__ */ jsx(Primitive2.div, { ...portalProps, ref: forwardedRef }), container) : null;
  });
  Portal3.displayName = PORTAL_NAME4;

  // ../../node_modules/.pnpm/@radix-ui+react-presence@1.1.5_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-presence/dist/index.mjs
  var React211 = __toESM(require_react(), 1);
  var React52 = __toESM(require_react(), 1);
  function useStateMachine2(initialState, machine) {
    return React52.useReducer((state, event) => {
      const nextState = machine[state][event];
      return nextState ?? state;
    }, initialState);
  }
  var Presence2 = (props) => {
    const { present, children } = props;
    const presence = usePresence2(present);
    const child = typeof children === "function" ? children({ present: presence.isPresent }) : React211.Children.only(children);
    const ref = useComposedRefs2(presence.ref, getElementRef5(child));
    const forceMount = typeof children === "function";
    return forceMount || presence.isPresent ? React211.cloneElement(child, { ref }) : null;
  };
  Presence2.displayName = "Presence";
  function usePresence2(present) {
    const [node, setNode] = React211.useState();
    const stylesRef = React211.useRef(null);
    const prevPresentRef = React211.useRef(present);
    const prevAnimationNameRef = React211.useRef("none");
    const initialState = present ? "mounted" : "unmounted";
    const [state, send] = useStateMachine2(initialState, {
      mounted: {
        UNMOUNT: "unmounted",
        ANIMATION_OUT: "unmountSuspended"
      },
      unmountSuspended: {
        MOUNT: "mounted",
        ANIMATION_END: "unmounted"
      },
      unmounted: {
        MOUNT: "mounted"
      }
    });
    React211.useEffect(() => {
      const currentAnimationName = getAnimationName2(stylesRef.current);
      prevAnimationNameRef.current = state === "mounted" ? currentAnimationName : "none";
    }, [state]);
    useLayoutEffect22(() => {
      const styles = stylesRef.current;
      const wasPresent = prevPresentRef.current;
      const hasPresentChanged = wasPresent !== present;
      if (hasPresentChanged) {
        const prevAnimationName = prevAnimationNameRef.current;
        const currentAnimationName = getAnimationName2(styles);
        if (present) {
          send("MOUNT");
        } else if (currentAnimationName === "none" || styles?.display === "none") {
          send("UNMOUNT");
        } else {
          const isAnimating = prevAnimationName !== currentAnimationName;
          if (wasPresent && isAnimating) {
            send("ANIMATION_OUT");
          } else {
            send("UNMOUNT");
          }
        }
        prevPresentRef.current = present;
      }
    }, [present, send]);
    useLayoutEffect22(() => {
      if (node) {
        let timeoutId;
        const ownerWindow = node.ownerDocument.defaultView ?? window;
        const handleAnimationEnd = (event) => {
          const currentAnimationName = getAnimationName2(stylesRef.current);
          const isCurrentAnimation = currentAnimationName.includes(CSS.escape(event.animationName));
          if (event.target === node && isCurrentAnimation) {
            send("ANIMATION_END");
            if (!prevPresentRef.current) {
              const currentFillMode = node.style.animationFillMode;
              node.style.animationFillMode = "forwards";
              timeoutId = ownerWindow.setTimeout(() => {
                if (node.style.animationFillMode === "forwards") {
                  node.style.animationFillMode = currentFillMode;
                }
              });
            }
          }
        };
        const handleAnimationStart = (event) => {
          if (event.target === node) {
            prevAnimationNameRef.current = getAnimationName2(stylesRef.current);
          }
        };
        node.addEventListener("animationstart", handleAnimationStart);
        node.addEventListener("animationcancel", handleAnimationEnd);
        node.addEventListener("animationend", handleAnimationEnd);
        return () => {
          ownerWindow.clearTimeout(timeoutId);
          node.removeEventListener("animationstart", handleAnimationStart);
          node.removeEventListener("animationcancel", handleAnimationEnd);
          node.removeEventListener("animationend", handleAnimationEnd);
        };
      } else {
        send("ANIMATION_END");
      }
    }, [node, send]);
    return {
      isPresent: ["mounted", "unmountSuspended"].includes(state),
      ref: React211.useCallback((node2) => {
        stylesRef.current = node2 ? getComputedStyle(node2) : null;
        setNode(node2);
      }, [])
    };
  }
  function getAnimationName2(styles) {
    return styles?.animationName || "none";
  }
  function getElementRef5(element) {
    let getter2 = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
    let mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.ref;
    }
    getter2 = Object.getOwnPropertyDescriptor(element, "ref")?.get;
    mayWarn = getter2 && "isReactWarning" in getter2 && getter2.isReactWarning;
    if (mayWarn) {
      return element.props.ref;
    }
    return element.props.ref || element.ref;
  }

  // ../../node_modules/.pnpm/@radix-ui+react-use-controllable-state@1.2.2_@types+react@18.3.12_react@19.2.3/node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
  var React53 = __toESM(require_react(), 1);
  var React212 = __toESM(require_react(), 1);
  var useInsertionEffect = React53[" useInsertionEffect ".trim().toString()] || useLayoutEffect22;
  function useControllableState2({
    prop,
    defaultProp,
    onChange = () => {
    },
    caller
  }) {
    const [uncontrolledProp, setUncontrolledProp, onChangeRef] = useUncontrolledState2({
      defaultProp,
      onChange
    });
    const isControlled = prop !== void 0;
    const value = isControlled ? prop : uncontrolledProp;
    if (true) {
      const isControlledRef = React53.useRef(prop !== void 0);
      React53.useEffect(() => {
        const wasControlled = isControlledRef.current;
        if (wasControlled !== isControlled) {
          const from = wasControlled ? "controlled" : "uncontrolled";
          const to = isControlled ? "controlled" : "uncontrolled";
          console.warn(
            `${caller} is changing from ${from} to ${to}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`
          );
        }
        isControlledRef.current = isControlled;
      }, [isControlled, caller]);
    }
    const setValue = React53.useCallback(
      (nextValue) => {
        if (isControlled) {
          const value2 = isFunction(nextValue) ? nextValue(prop) : nextValue;
          if (value2 !== prop) {
            onChangeRef.current?.(value2);
          }
        } else {
          setUncontrolledProp(nextValue);
        }
      },
      [isControlled, prop, setUncontrolledProp, onChangeRef]
    );
    return [value, setValue];
  }
  function useUncontrolledState2({
    defaultProp,
    onChange
  }) {
    const [value, setValue] = React53.useState(defaultProp);
    const prevValueRef = React53.useRef(value);
    const onChangeRef = React53.useRef(onChange);
    useInsertionEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);
    React53.useEffect(() => {
      if (prevValueRef.current !== value) {
        onChangeRef.current?.(value);
        prevValueRef.current = value;
      }
    }, [value, prevValueRef]);
    return [value, setValue, onChangeRef];
  }
  function isFunction(value) {
    return typeof value === "function";
  }
  var SYNC_STATE = Symbol("RADIX:SYNC_STATE");

  // ../../node_modules/.pnpm/@radix-ui+react-visually-hidden@1.2.3_@types+react-dom@18.3.1_@types+react@18.3.12_reac_3795bdad014cb2641d7688daa1175481/node_modules/@radix-ui/react-visually-hidden/dist/index.mjs
  var React54 = __toESM(require_react(), 1);
  var VISUALLY_HIDDEN_STYLES = Object.freeze({
    // See: https://github.com/twbs/bootstrap/blob/main/scss/mixins/_visually-hidden.scss
    position: "absolute",
    border: 0,
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    wordWrap: "normal"
  });
  var NAME4 = "VisuallyHidden";
  var VisuallyHidden2 = React54.forwardRef(
    (props, forwardedRef) => {
      return /* @__PURE__ */ jsx(
        Primitive2.span,
        {
          ...props,
          ref: forwardedRef,
          style: { ...VISUALLY_HIDDEN_STYLES, ...props.style }
        }
      );
    }
  );
  VisuallyHidden2.displayName = NAME4;
  var Root6 = VisuallyHidden2;

  // ../../node_modules/.pnpm/@radix-ui+react-tooltip@1.2.8_@types+react-dom@18.3.1_@types+react@18.3.12_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@radix-ui/react-tooltip/dist/index.mjs
  var [createTooltipContext2, createTooltipScope2] = createContextScope3("Tooltip", [
    createPopperScope2
  ]);
  var usePopperScope2 = createPopperScope2();
  var PROVIDER_NAME2 = "TooltipProvider";
  var DEFAULT_DELAY_DURATION2 = 700;
  var TOOLTIP_OPEN2 = "tooltip.open";
  var [TooltipProviderContextProvider2, useTooltipProviderContext2] = createTooltipContext2(PROVIDER_NAME2);
  var TooltipProvider3 = (props) => {
    const {
      __scopeTooltip,
      delayDuration = DEFAULT_DELAY_DURATION2,
      skipDelayDuration = 300,
      disableHoverableContent = false,
      children
    } = props;
    const isOpenDelayedRef = React55.useRef(true);
    const isPointerInTransitRef = React55.useRef(false);
    const skipDelayTimerRef = React55.useRef(0);
    React55.useEffect(() => {
      const skipDelayTimer = skipDelayTimerRef.current;
      return () => window.clearTimeout(skipDelayTimer);
    }, []);
    return /* @__PURE__ */ jsx(
      TooltipProviderContextProvider2,
      {
        scope: __scopeTooltip,
        isOpenDelayedRef,
        delayDuration,
        onOpen: React55.useCallback(() => {
          window.clearTimeout(skipDelayTimerRef.current);
          isOpenDelayedRef.current = false;
        }, []),
        onClose: React55.useCallback(() => {
          window.clearTimeout(skipDelayTimerRef.current);
          skipDelayTimerRef.current = window.setTimeout(
            () => isOpenDelayedRef.current = true,
            skipDelayDuration
          );
        }, [skipDelayDuration]),
        isPointerInTransitRef,
        onPointerInTransitChange: React55.useCallback((inTransit) => {
          isPointerInTransitRef.current = inTransit;
        }, []),
        disableHoverableContent,
        children
      }
    );
  };
  TooltipProvider3.displayName = PROVIDER_NAME2;
  var TOOLTIP_NAME2 = "Tooltip";
  var [TooltipContextProvider2, useTooltipContext2] = createTooltipContext2(TOOLTIP_NAME2);
  var Tooltip3 = (props) => {
    const {
      __scopeTooltip,
      children,
      open: openProp,
      defaultOpen,
      onOpenChange,
      disableHoverableContent: disableHoverableContentProp,
      delayDuration: delayDurationProp
    } = props;
    const providerContext = useTooltipProviderContext2(TOOLTIP_NAME2, props.__scopeTooltip);
    const popperScope = usePopperScope2(__scopeTooltip);
    const [trigger, setTrigger] = React55.useState(null);
    const contentId = useId2();
    const openTimerRef = React55.useRef(0);
    const disableHoverableContent = disableHoverableContentProp ?? providerContext.disableHoverableContent;
    const delayDuration = delayDurationProp ?? providerContext.delayDuration;
    const wasOpenDelayedRef = React55.useRef(false);
    const [open, setOpen] = useControllableState2({
      prop: openProp,
      defaultProp: defaultOpen ?? false,
      onChange: (open2) => {
        if (open2) {
          providerContext.onOpen();
          document.dispatchEvent(new CustomEvent(TOOLTIP_OPEN2));
        } else {
          providerContext.onClose();
        }
        onOpenChange?.(open2);
      },
      caller: TOOLTIP_NAME2
    });
    const stateAttribute = React55.useMemo(() => {
      return open ? wasOpenDelayedRef.current ? "delayed-open" : "instant-open" : "closed";
    }, [open]);
    const handleOpen = React55.useCallback(() => {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = 0;
      wasOpenDelayedRef.current = false;
      setOpen(true);
    }, [setOpen]);
    const handleClose = React55.useCallback(() => {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = 0;
      setOpen(false);
    }, [setOpen]);
    const handleDelayedOpen = React55.useCallback(() => {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = window.setTimeout(() => {
        wasOpenDelayedRef.current = true;
        setOpen(true);
        openTimerRef.current = 0;
      }, delayDuration);
    }, [delayDuration, setOpen]);
    React55.useEffect(() => {
      return () => {
        if (openTimerRef.current) {
          window.clearTimeout(openTimerRef.current);
          openTimerRef.current = 0;
        }
      };
    }, []);
    return /* @__PURE__ */ jsx(Root22, { ...popperScope, children: /* @__PURE__ */ jsx(
      TooltipContextProvider2,
      {
        scope: __scopeTooltip,
        contentId,
        open,
        stateAttribute,
        trigger,
        onTriggerChange: setTrigger,
        onTriggerEnter: React55.useCallback(() => {
          if (providerContext.isOpenDelayedRef.current) handleDelayedOpen();
          else handleOpen();
        }, [providerContext.isOpenDelayedRef, handleDelayedOpen, handleOpen]),
        onTriggerLeave: React55.useCallback(() => {
          if (disableHoverableContent) {
            handleClose();
          } else {
            window.clearTimeout(openTimerRef.current);
            openTimerRef.current = 0;
          }
        }, [handleClose, disableHoverableContent]),
        onOpen: handleOpen,
        onClose: handleClose,
        disableHoverableContent,
        children
      }
    ) });
  };
  Tooltip3.displayName = TOOLTIP_NAME2;
  var TRIGGER_NAME3 = "TooltipTrigger";
  var TooltipTrigger3 = React55.forwardRef(
    (props, forwardedRef) => {
      const { __scopeTooltip, ...triggerProps } = props;
      const context = useTooltipContext2(TRIGGER_NAME3, __scopeTooltip);
      const providerContext = useTooltipProviderContext2(TRIGGER_NAME3, __scopeTooltip);
      const popperScope = usePopperScope2(__scopeTooltip);
      const ref = React55.useRef(null);
      const composedRefs = useComposedRefs2(forwardedRef, ref, context.onTriggerChange);
      const isPointerDownRef = React55.useRef(false);
      const hasPointerMoveOpenedRef = React55.useRef(false);
      const handlePointerUp = React55.useCallback(() => isPointerDownRef.current = false, []);
      React55.useEffect(() => {
        return () => document.removeEventListener("pointerup", handlePointerUp);
      }, [handlePointerUp]);
      return /* @__PURE__ */ jsx(Anchor2, { asChild: true, ...popperScope, children: /* @__PURE__ */ jsx(
        Primitive2.button,
        {
          "aria-describedby": context.open ? context.contentId : void 0,
          "data-state": context.stateAttribute,
          ...triggerProps,
          ref: composedRefs,
          onPointerMove: composeEventHandlers2(props.onPointerMove, (event) => {
            if (event.pointerType === "touch") return;
            if (!hasPointerMoveOpenedRef.current && !providerContext.isPointerInTransitRef.current) {
              context.onTriggerEnter();
              hasPointerMoveOpenedRef.current = true;
            }
          }),
          onPointerLeave: composeEventHandlers2(props.onPointerLeave, () => {
            context.onTriggerLeave();
            hasPointerMoveOpenedRef.current = false;
          }),
          onPointerDown: composeEventHandlers2(props.onPointerDown, () => {
            if (context.open) {
              context.onClose();
            }
            isPointerDownRef.current = true;
            document.addEventListener("pointerup", handlePointerUp, { once: true });
          }),
          onFocus: composeEventHandlers2(props.onFocus, () => {
            if (!isPointerDownRef.current) context.onOpen();
          }),
          onBlur: composeEventHandlers2(props.onBlur, context.onClose),
          onClick: composeEventHandlers2(props.onClick, context.onClose)
        }
      ) });
    }
  );
  TooltipTrigger3.displayName = TRIGGER_NAME3;
  var PORTAL_NAME5 = "TooltipPortal";
  var [PortalProvider3, usePortalContext3] = createTooltipContext2(PORTAL_NAME5, {
    forceMount: void 0
  });
  var TooltipPortal2 = (props) => {
    const { __scopeTooltip, forceMount, children, container } = props;
    const context = useTooltipContext2(PORTAL_NAME5, __scopeTooltip);
    return /* @__PURE__ */ jsx(PortalProvider3, { scope: __scopeTooltip, forceMount, children: /* @__PURE__ */ jsx(Presence2, { present: forceMount || context.open, children: /* @__PURE__ */ jsx(Portal3, { asChild: true, container, children }) }) });
  };
  TooltipPortal2.displayName = PORTAL_NAME5;
  var CONTENT_NAME5 = "TooltipContent";
  var TooltipContent3 = React55.forwardRef(
    (props, forwardedRef) => {
      const portalContext = usePortalContext3(CONTENT_NAME5, props.__scopeTooltip);
      const { forceMount = portalContext.forceMount, side = "top", ...contentProps } = props;
      const context = useTooltipContext2(CONTENT_NAME5, props.__scopeTooltip);
      return /* @__PURE__ */ jsx(Presence2, { present: forceMount || context.open, children: context.disableHoverableContent ? /* @__PURE__ */ jsx(TooltipContentImpl2, { side, ...contentProps, ref: forwardedRef }) : /* @__PURE__ */ jsx(TooltipContentHoverable2, { side, ...contentProps, ref: forwardedRef }) });
    }
  );
  var TooltipContentHoverable2 = React55.forwardRef((props, forwardedRef) => {
    const context = useTooltipContext2(CONTENT_NAME5, props.__scopeTooltip);
    const providerContext = useTooltipProviderContext2(CONTENT_NAME5, props.__scopeTooltip);
    const ref = React55.useRef(null);
    const composedRefs = useComposedRefs2(forwardedRef, ref);
    const [pointerGraceArea, setPointerGraceArea] = React55.useState(null);
    const { trigger, onClose } = context;
    const content = ref.current;
    const { onPointerInTransitChange } = providerContext;
    const handleRemoveGraceArea = React55.useCallback(() => {
      setPointerGraceArea(null);
      onPointerInTransitChange(false);
    }, [onPointerInTransitChange]);
    const handleCreateGraceArea = React55.useCallback(
      (event, hoverTarget) => {
        const currentTarget = event.currentTarget;
        const exitPoint = { x: event.clientX, y: event.clientY };
        const exitSide = getExitSideFromRect2(exitPoint, currentTarget.getBoundingClientRect());
        const paddedExitPoints = getPaddedExitPoints2(exitPoint, exitSide);
        const hoverTargetPoints = getPointsFromRect2(hoverTarget.getBoundingClientRect());
        const graceArea = getHull2([...paddedExitPoints, ...hoverTargetPoints]);
        setPointerGraceArea(graceArea);
        onPointerInTransitChange(true);
      },
      [onPointerInTransitChange]
    );
    React55.useEffect(() => {
      return () => handleRemoveGraceArea();
    }, [handleRemoveGraceArea]);
    React55.useEffect(() => {
      if (trigger && content) {
        const handleTriggerLeave = (event) => handleCreateGraceArea(event, content);
        const handleContentLeave = (event) => handleCreateGraceArea(event, trigger);
        trigger.addEventListener("pointerleave", handleTriggerLeave);
        content.addEventListener("pointerleave", handleContentLeave);
        return () => {
          trigger.removeEventListener("pointerleave", handleTriggerLeave);
          content.removeEventListener("pointerleave", handleContentLeave);
        };
      }
    }, [trigger, content, handleCreateGraceArea, handleRemoveGraceArea]);
    React55.useEffect(() => {
      if (pointerGraceArea) {
        const handleTrackPointerGrace = (event) => {
          const target = event.target;
          const pointerPosition = { x: event.clientX, y: event.clientY };
          const hasEnteredTarget = trigger?.contains(target) || content?.contains(target);
          const isPointerOutsideGraceArea = !isPointInPolygon2(pointerPosition, pointerGraceArea);
          if (hasEnteredTarget) {
            handleRemoveGraceArea();
          } else if (isPointerOutsideGraceArea) {
            handleRemoveGraceArea();
            onClose();
          }
        };
        document.addEventListener("pointermove", handleTrackPointerGrace);
        return () => document.removeEventListener("pointermove", handleTrackPointerGrace);
      }
    }, [trigger, content, pointerGraceArea, onClose, handleRemoveGraceArea]);
    return /* @__PURE__ */ jsx(TooltipContentImpl2, { ...props, ref: composedRefs });
  });
  var [VisuallyHiddenContentContextProvider2, useVisuallyHiddenContentContext2] = createTooltipContext2(TOOLTIP_NAME2, { isInside: false });
  var Slottable3 = createSlottable2("TooltipContent");
  var TooltipContentImpl2 = React55.forwardRef(
    (props, forwardedRef) => {
      const {
        __scopeTooltip,
        children,
        "aria-label": ariaLabel,
        onEscapeKeyDown,
        onPointerDownOutside,
        ...contentProps
      } = props;
      const context = useTooltipContext2(CONTENT_NAME5, __scopeTooltip);
      const popperScope = usePopperScope2(__scopeTooltip);
      const { onClose } = context;
      React55.useEffect(() => {
        document.addEventListener(TOOLTIP_OPEN2, onClose);
        return () => document.removeEventListener(TOOLTIP_OPEN2, onClose);
      }, [onClose]);
      React55.useEffect(() => {
        if (context.trigger) {
          const handleScroll2 = (event) => {
            const target = event.target;
            if (target?.contains(context.trigger)) onClose();
          };
          window.addEventListener("scroll", handleScroll2, { capture: true });
          return () => window.removeEventListener("scroll", handleScroll2, { capture: true });
        }
      }, [context.trigger, onClose]);
      return /* @__PURE__ */ jsx(
        DismissableLayer2,
        {
          asChild: true,
          disableOutsidePointerEvents: false,
          onEscapeKeyDown,
          onPointerDownOutside,
          onFocusOutside: (event) => event.preventDefault(),
          onDismiss: onClose,
          children: /* @__PURE__ */ jsxs(
            Content3,
            {
              "data-state": context.stateAttribute,
              ...popperScope,
              ...contentProps,
              ref: forwardedRef,
              style: {
                ...contentProps.style,
                // re-namespace exposed content custom properties
                ...{
                  "--radix-tooltip-content-transform-origin": "var(--radix-popper-transform-origin)",
                  "--radix-tooltip-content-available-width": "var(--radix-popper-available-width)",
                  "--radix-tooltip-content-available-height": "var(--radix-popper-available-height)",
                  "--radix-tooltip-trigger-width": "var(--radix-popper-anchor-width)",
                  "--radix-tooltip-trigger-height": "var(--radix-popper-anchor-height)"
                }
              },
              children: [
                /* @__PURE__ */ jsx(Slottable3, { children }),
                /* @__PURE__ */ jsx(VisuallyHiddenContentContextProvider2, { scope: __scopeTooltip, isInside: true, children: /* @__PURE__ */ jsx(Root6, { id: context.contentId, role: "tooltip", children: ariaLabel || children }) })
              ]
            }
          )
        }
      );
    }
  );
  TooltipContent3.displayName = CONTENT_NAME5;
  var ARROW_NAME4 = "TooltipArrow";
  var TooltipArrow2 = React55.forwardRef(
    (props, forwardedRef) => {
      const { __scopeTooltip, ...arrowProps } = props;
      const popperScope = usePopperScope2(__scopeTooltip);
      const visuallyHiddenContentContext = useVisuallyHiddenContentContext2(
        ARROW_NAME4,
        __scopeTooltip
      );
      return visuallyHiddenContentContext.isInside ? null : /* @__PURE__ */ jsx(Arrow4, { ...popperScope, ...arrowProps, ref: forwardedRef });
    }
  );
  TooltipArrow2.displayName = ARROW_NAME4;
  function getExitSideFromRect2(point, rect) {
    const top = Math.abs(rect.top - point.y);
    const bottom = Math.abs(rect.bottom - point.y);
    const right = Math.abs(rect.right - point.x);
    const left = Math.abs(rect.left - point.x);
    switch (Math.min(top, bottom, right, left)) {
      case left:
        return "left";
      case right:
        return "right";
      case top:
        return "top";
      case bottom:
        return "bottom";
      default:
        throw new Error("unreachable");
    }
  }
  function getPaddedExitPoints2(exitPoint, exitSide, padding = 5) {
    const paddedExitPoints = [];
    switch (exitSide) {
      case "top":
        paddedExitPoints.push(
          { x: exitPoint.x - padding, y: exitPoint.y + padding },
          { x: exitPoint.x + padding, y: exitPoint.y + padding }
        );
        break;
      case "bottom":
        paddedExitPoints.push(
          { x: exitPoint.x - padding, y: exitPoint.y - padding },
          { x: exitPoint.x + padding, y: exitPoint.y - padding }
        );
        break;
      case "left":
        paddedExitPoints.push(
          { x: exitPoint.x + padding, y: exitPoint.y - padding },
          { x: exitPoint.x + padding, y: exitPoint.y + padding }
        );
        break;
      case "right":
        paddedExitPoints.push(
          { x: exitPoint.x - padding, y: exitPoint.y - padding },
          { x: exitPoint.x - padding, y: exitPoint.y + padding }
        );
        break;
    }
    return paddedExitPoints;
  }
  function getPointsFromRect2(rect) {
    const { top, right, bottom, left } = rect;
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ];
  }
  function isPointInPolygon2(point, polygon) {
    const { x, y } = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const ii = polygon[i];
      const jj = polygon[j];
      const xi = ii.x;
      const yi = ii.y;
      const xj = jj.x;
      const yj = jj.y;
      const intersect = yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function getHull2(points) {
    const newPoints = points.slice();
    newPoints.sort((a8, b) => {
      if (a8.x < b.x) return -1;
      else if (a8.x > b.x) return 1;
      else if (a8.y < b.y) return -1;
      else if (a8.y > b.y) return 1;
      else return 0;
    });
    return getHullPresorted2(newPoints);
  }
  function getHullPresorted2(points) {
    if (points.length <= 1) return points.slice();
    const upperHull = [];
    for (let i = 0; i < points.length; i++) {
      const p2 = points[i];
      while (upperHull.length >= 2) {
        const q = upperHull[upperHull.length - 1];
        const r5 = upperHull[upperHull.length - 2];
        if ((q.x - r5.x) * (p2.y - r5.y) >= (q.y - r5.y) * (p2.x - r5.x)) upperHull.pop();
        else break;
      }
      upperHull.push(p2);
    }
    upperHull.pop();
    const lowerHull = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p2 = points[i];
      while (lowerHull.length >= 2) {
        const q = lowerHull[lowerHull.length - 1];
        const r5 = lowerHull[lowerHull.length - 2];
        if ((q.x - r5.x) * (p2.y - r5.y) >= (q.y - r5.y) * (p2.x - r5.x)) lowerHull.pop();
        else break;
      }
      lowerHull.push(p2);
    }
    lowerHull.pop();
    if (upperHull.length === 1 && lowerHull.length === 1 && upperHull[0].x === lowerHull[0].x && upperHull[0].y === lowerHull[0].y) {
      return upperHull;
    } else {
      return upperHull.concat(lowerHull);
    }
  }

  // src/components/pill-toggle.tsx
  var sizeClasses = /* @__PURE__ */ new Map([
    ["sm", { button: "px-3 py-1.5 text-xs", icon: "h-3.5 w-3.5" }],
    ["md", { button: "px-4 py-2 text-sm", icon: "h-4 w-4" }],
    ["lg", { button: "px-5 py-2.5 text-sm", icon: "h-4 w-4" }]
  ]);
  var gradientClasses = /* @__PURE__ */ new Map([
    ["blue", "ring-blue-500/20 dark:ring-blue-400/20"],
    ["cyan", "ring-cyan-500/20 dark:ring-cyan-400/20"],
    ["purple", "ring-purple-500/20 dark:ring-purple-400/20"],
    ["green", "ring-emerald-500/20 dark:ring-emerald-400/20"],
    ["orange", "ring-amber-500/20 dark:ring-amber-400/20"],
    ["default", "ring-black/[0.12] dark:ring-white/[0.06]"]
  ]);
  function getMapValueOrThrow3(map, key, mapName) {
    const value = map.get(key);
    if (!value) {
      throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
    }
    return value;
  }
  function DesignPillToggle({
    options,
    selected,
    onSelect,
    size: size5 = "md",
    glassmorphic: glassmorphicProp,
    gradient = "default",
    showLabels = true,
    className
  }) {
    const glassmorphic = useGlassmorphicDefault(glassmorphicProp);
    const sizeClass = getMapValueOrThrow3(sizeClasses, size5, "sizeClasses");
    const activeRingClass = getMapValueOrThrow3(gradientClasses, gradient, "gradientClasses");
    const [loadingOptionId, setLoadingOptionId] = (0, import_react22.useState)(null);
    const handleClick = (optionId) => {
      const result = onSelect(optionId);
      if (result && typeof result.then === "function") {
        setLoadingOptionId(optionId);
        runAsynchronouslyWithAlert(
          Promise.resolve(result).finally(() => setLoadingOptionId(null))
        );
      }
    };
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: cn(
          "inline-flex items-center gap-1 p-1 rounded-xl",
          glassmorphic ? "bg-foreground/[0.04] backdrop-blur-sm" : "bg-black/[0.08] dark:bg-white/[0.04]",
          className
        ),
        children: options.map((option) => {
          const isActive = selected === option.id;
          const Icon = option.icon;
          const pill = /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => handleClick(option.id),
              disabled: loadingOptionId !== null,
              className: cn(
                "relative flex items-center gap-2 font-medium rounded-lg transition-all duration-150 hover:transition-none",
                sizeClass.button,
                isActive ? cn(
                  "bg-background text-foreground shadow-sm ring-1",
                  glassmorphic ? "ring-foreground/[0.06] dark:bg-[hsl(240,71%,70%)]/10 dark:text-[hsl(240,71%,90%)] dark:ring-[hsl(240,71%,70%)]/20" : activeRingClass
                ) : cn(
                  "text-muted-foreground hover:text-foreground",
                  glassmorphic ? "hover:bg-background/50" : "hover:bg-black/[0.06] dark:hover:bg-white/[0.04]"
                )
              ),
              children: [
                loadingOptionId === option.id && /* @__PURE__ */ jsx(
                  Spinner,
                  {
                    size: 12,
                    className: "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  }
                ),
                /* @__PURE__ */ jsxs("span", { className: cn(
                  "flex items-center gap-2",
                  loadingOptionId === option.id && "invisible"
                ), children: [
                  Icon && /* @__PURE__ */ jsx(Icon, { className: sizeClass.icon }),
                  showLabels && option.label
                ] })
              ]
            },
            option.id
          );
          if (!showLabels) {
            return /* @__PURE__ */ jsxs(Tooltip2, { delayDuration: 0, children: [
              /* @__PURE__ */ jsx(TooltipTrigger2, { asChild: true, children: pill }),
              /* @__PURE__ */ jsx(TooltipPortal2, { children: /* @__PURE__ */ jsx(TooltipContent2, { side: "top", children: option.label }) })
            ] }, option.id);
          }
          return pill;
        })
      }
    );
  }

  // src/components/separator.tsx
  function DesignSeparator({
    orientation = "horizontal",
    className,
    ...props
  }) {
    return /* @__PURE__ */ jsx(
      "div",
      {
        role: "separator",
        "aria-orientation": orientation,
        className: cn(
          orientation === "horizontal" ? "h-[1px] w-full bg-black/[0.08] dark:bg-white/[0.06]" : "w-[1px] h-full bg-black/[0.08] dark:bg-white/[0.06]",
          className
        ),
        ...props
      }
    );
  }

  // src/components/skeleton.tsx
  function DesignSkeleton({ className, ...props }) {
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: cn(
          "animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.06]",
          className
        ),
        ...props
      }
    );
  }

  // src/components/table.tsx
  var DesignTable = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx("div", { className: "relative w-full overflow-auto", children: /* @__PURE__ */ jsx(
    "table",
    {
      ref,
      className: cn("w-full caption-bottom text-sm", className),
      ...props
    }
  ) }));
  DesignTable.displayName = "DesignTable";
  var DesignTableHeader = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
    "thead",
    {
      ref,
      className: cn("bg-foreground/[0.02] [&_tr]:border-b [&_tr]:border-black/[0.06] dark:[&_tr]:border-white/[0.06]", className),
      ...props
    }
  ));
  DesignTableHeader.displayName = "DesignTableHeader";
  var DesignTableBody = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
    "tbody",
    {
      ref,
      className: cn("[&_tr:last-child]:border-0", className),
      ...props
    }
  ));
  DesignTableBody.displayName = "DesignTableBody";
  var DesignTableRow = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
    "tr",
    {
      ref,
      className: cn(
        "border-b border-black/[0.06] dark:border-white/[0.06] transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.04] data-[state=selected]:bg-foreground/[0.06]",
        className
      ),
      ...props
    }
  ));
  DesignTableRow.displayName = "DesignTableRow";
  var DesignTableHead = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
    "th",
    {
      ref,
      className: cn(
        "h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      ),
      ...props
    }
  ));
  DesignTableHead.displayName = "DesignTableHead";
  var DesignTableCell = forwardRefIfNeeded(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
    "td",
    {
      ref,
      className: cn(
        "p-4 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      ),
      ...props
    }
  ));
  DesignTableCell.displayName = "DesignTableCell";

  // src/components/tabs.tsx
  var import_react24 = __toESM(require_react());
  var tabSizeClasses = /* @__PURE__ */ new Map([
    ["sm", { button: "px-3 py-2 text-xs", badge: "text-[10px] px-1.5 py-0.5" }],
    ["md", { button: "px-4 py-3 text-sm", badge: "text-xs px-1.5 py-0.5" }]
  ]);
  var gradientClasses2 = /* @__PURE__ */ new Map([
    [
      "blue",
      {
        activeText: "text-blue-700 dark:text-blue-400",
        activeBadge: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
        underline: "bg-blue-700 dark:bg-blue-400"
      }
    ],
    [
      "cyan",
      {
        activeText: "text-cyan-700 dark:text-cyan-300",
        activeBadge: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300",
        underline: "bg-cyan-600 dark:bg-cyan-400"
      }
    ],
    [
      "purple",
      {
        activeText: "text-purple-700 dark:text-purple-300",
        activeBadge: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
        underline: "bg-purple-600 dark:bg-purple-400"
      }
    ],
    [
      "green",
      {
        activeText: "text-emerald-700 dark:text-emerald-300",
        activeBadge: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
        underline: "bg-emerald-600 dark:bg-emerald-400"
      }
    ],
    [
      "orange",
      {
        activeText: "text-amber-700 dark:text-amber-300",
        activeBadge: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
        underline: "bg-amber-600 dark:bg-amber-400"
      }
    ],
    [
      "default",
      {
        activeText: "text-foreground",
        activeBadge: "bg-foreground/10 text-foreground",
        underline: "bg-foreground/80"
      }
    ]
  ]);
  function getMapValueOrThrow4(map, key, mapName) {
    const value = map.get(key);
    if (!value) {
      throw new Error(`Missing ${mapName} entry for key "${String(key)}"`);
    }
    return value;
  }
  function DesignCategoryTabs({
    categories,
    selectedCategory,
    onSelect,
    showBadge = true,
    size: size5 = "sm",
    glassmorphic: glassmorphicProp,
    gradient = "blue",
    className,
    ...props
  }) {
    const glassmorphic = useGlassmorphicDefault(glassmorphicProp);
    const sizeClass = getMapValueOrThrow4(tabSizeClasses, size5, "tabSizeClasses");
    const gradientClass = getMapValueOrThrow4(gradientClasses2, gradient, "gradientClasses");
    const [loadingCategoryId, setLoadingCategoryId] = (0, import_react24.useState)(null);
    const handleSelect = (categoryId) => {
      const result = onSelect(categoryId);
      if (result && typeof result.then === "function") {
        setLoadingCategoryId(categoryId);
        runAsynchronouslyWithAlert(
          Promise.resolve(result).finally(() => setLoadingCategoryId(null))
        );
      }
    };
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: cn(
          "flex items-center gap-1 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden",
          glassmorphic ? "rounded-xl bg-black/[0.08] dark:bg-white/[0.04] p-1 backdrop-blur-sm" : "border-b border-gray-300 dark:border-gray-800",
          className
        ),
        ...props,
        children: categories.map((category) => {
          const isActive = selectedCategory === category.id;
          const badgeValue = category.badgeCount ?? category.count;
          const shouldShowBadge = showBadge && badgeValue !== void 0;
          return /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => handleSelect(category.id),
              disabled: loadingCategoryId !== null,
              className: cn(
                "font-medium transition-all duration-150 hover:transition-none relative flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap",
                "hover:text-gray-900 dark:hover:text-gray-100",
                sizeClass.button,
                glassmorphic ? "rounded-lg" : "",
                isActive ? cn(
                  gradientClass.activeText,
                  glassmorphic && "bg-background shadow-sm ring-1 ring-black/[0.12] dark:ring-white/[0.06]"
                ) : "text-gray-700 dark:text-gray-400"
              ),
              children: [
                loadingCategoryId === category.id && /* @__PURE__ */ jsx(
                  Spinner,
                  {
                    size: 12,
                    className: "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  }
                ),
                /* @__PURE__ */ jsxs("span", { className: cn(
                  "flex items-center gap-2",
                  loadingCategoryId === category.id && "invisible"
                ), children: [
                  category.label,
                  shouldShowBadge && /* @__PURE__ */ jsx(
                    "span",
                    {
                      className: cn(
                        "rounded-full",
                        sizeClass.badge,
                        isActive ? gradientClass.activeBadge : "bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                      ),
                      children: badgeValue
                    }
                  )
                ] }),
                !glassmorphic && isActive && /* @__PURE__ */ jsx("div", { className: cn("absolute bottom-0 left-0 right-0 h-0.5", gradientClass.underline) })
              ]
            },
            category.id
          );
        })
      }
    );
  }

  // src/components/chart-theme.tsx
  var DESIGN_CHART_COLORS = [
    { light: "hsl(221, 83%, 53%)", dark: "hsl(217, 91%, 60%)" },
    // blue
    { light: "hsl(192, 91%, 36%)", dark: "hsl(188, 94%, 43%)" },
    // cyan
    { light: "hsl(271, 91%, 65%)", dark: "hsl(270, 95%, 75%)" },
    // purple
    { light: "hsl(160, 84%, 39%)", dark: "hsl(160, 84%, 45%)" },
    // emerald/green
    { light: "hsl(38, 92%, 50%)", dark: "hsl(38, 92%, 50%)" },
    // amber/orange
    { light: "hsl(0, 84%, 60%)", dark: "hsl(0, 84%, 65%)" }
    // red
  ];
  var colorNameIndexMap = /* @__PURE__ */ new Map([
    ["blue", 0],
    ["cyan", 1],
    ["purple", 2],
    ["green", 3],
    ["orange", 4],
    ["red", 5]
  ]);
  function getDesignChartColor(indexOrName, mode = "dark") {
    const index3 = typeof indexOrName === "string" ? colorNameIndexMap.get(indexOrName) ?? 0 : indexOrName % DESIGN_CHART_COLORS.length;
    return DESIGN_CHART_COLORS[index3][mode];
  }
  var DESIGN_CHART_GRID_COLOR = "hsl(0 0% 50% / 0.12)";
  var DESIGN_CHART_AXIS_TICK_STYLE = {
    fill: "hsl(0 0% 50% / 0.5)",
    fontSize: 11
  };

  // src/components/chart-container.tsx
  var React56 = __toESM(require_react());
  var RechartsPrimitive = __toESM(require_recharts());
  var THEMES = { light: "", dark: ".dark" };
  var ChartContext = React56.createContext(null);
  function useDesignChart() {
    const context = React56.useContext(ChartContext);
    if (!context) {
      throw new Error("useDesignChart must be used within a <DesignChartContainer />");
    }
    return context;
  }
  function DesignChartStyle({ id, config }) {
    const colorConfig = Object.entries(config).filter(
      ([_, cfg]) => cfg.theme || cfg.color
    );
    if (!colorConfig.length) {
      return null;
    }
    return /* @__PURE__ */ jsx(
      "style",
      {
        dangerouslySetInnerHTML: {
          __html: Object.entries(THEMES).map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig.map(([key, itemConfig]) => {
              const color = itemConfig.theme?.[theme] || itemConfig.color;
              return color ? `  --color-${key}: ${color};` : null;
            }).join("\n")}
}
`
          ).join("\n")
        }
      }
    );
  }
  var DesignChartContainer = React56.forwardRef(({ id, className, children, config, maxHeight, ...props }, ref) => {
    const uniqueId = React56.useId();
    const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;
    return /* @__PURE__ */ jsx(ChartContext.Provider, { value: { config }, children: /* @__PURE__ */ jsxs(
      "div",
      {
        "data-chart": chartId,
        ref,
        className: cn(
          "flex aspect-video justify-center text-xs",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-black/[0.06] dark:[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-white/[0.06]",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-black/[0.12] dark:[&_.recharts-curve.recharts-tooltip-cursor]:stroke-white/[0.12]",
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-none",
          "[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-black/[0.06] dark:[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-white/[0.06]",
          "[&_.recharts-radial-bar-background-sector]:fill-black/[0.04] dark:[&_.recharts-radial-bar-background-sector]:fill-white/[0.04]",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-black/[0.04] dark:[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-white/[0.04]",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-black/[0.06] dark:[&_.recharts-reference-line_[stroke='#ccc']]:stroke-white/[0.06]",
          "[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-sector]:outline-none",
          "[&_.recharts-surface]:outline-none",
          className
        ),
        ...props,
        style: {
          ...props.style,
          maxHeight
        },
        children: [
          /* @__PURE__ */ jsx(DesignChartStyle, { id: chartId, config }),
          /* @__PURE__ */ jsx(RechartsPrimitive.ResponsiveContainer, { maxHeight, children })
        ]
      }
    ) });
  });
  DesignChartContainer.displayName = "DesignChartContainer";
  function getPayloadConfigFromPayload(config, payload, key) {
    if (typeof payload !== "object" || payload === null) {
      return void 0;
    }
    const payloadPayload = "payload" in payload && typeof payload.payload === "object" && payload.payload !== null ? payload.payload : void 0;
    let configLabelKey = key;
    if (key in payload && typeof payload[key] === "string") {
      configLabelKey = payload[key];
    } else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key] === "string") {
      configLabelKey = payloadPayload[key];
    }
    return configLabelKey in config ? config[configLabelKey] : config[key];
  }

  // src/components/chart-tooltip.tsx
  var React57 = __toESM(require_react());
  var RechartsPrimitive2 = __toESM(require_recharts());
  var DesignChartTooltip = RechartsPrimitive2.Tooltip;
  var DesignChartTooltipContent = React57.forwardRef(
    ({
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey
    }, ref) => {
      const { config } = useDesignChart();
      const tooltipLabel = React57.useMemo(() => {
        if (hideLabel || !payload?.length) {
          return null;
        }
        const [item] = payload;
        const key = `${labelKey || item.dataKey || item.name || "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);
        const configEntry = typeof label === "string" ? config[label] : void 0;
        const value = !labelKey && typeof label === "string" ? configEntry?.label ?? label : itemConfig?.label;
        if (labelFormatter) {
          return /* @__PURE__ */ jsx("div", { className: cn("font-medium text-muted-foreground tracking-wide", labelClassName), children: labelFormatter(value, payload) });
        }
        if (!value) {
          return null;
        }
        return /* @__PURE__ */ jsx("div", { className: cn("font-medium text-muted-foreground tracking-wide", labelClassName), children: value });
      }, [
        label,
        labelFormatter,
        payload,
        hideLabel,
        labelClassName,
        config,
        labelKey
      ]);
      if (!active || !payload?.length) {
        return null;
      }
      const nestLabel = payload.length === 1 && indicator !== "dot";
      return /* @__PURE__ */ jsxs(
        "div",
        {
          ref,
          className: cn(
            "grid min-w-[8rem] items-start gap-1.5 rounded-xl bg-background/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]",
            className
          ),
          style: { zIndex: 9999 },
          children: [
            !nestLabel ? tooltipLabel : null,
            /* @__PURE__ */ jsx("div", { className: "grid gap-1.5", children: payload.map((item, index3) => {
              const key = `${nameKey || item.name || item.dataKey || "value"}`;
              const itemConfig = getPayloadConfigFromPayload(config, item, key);
              const indicatorColor = color || item.payload.fill || item.color;
              return /* @__PURE__ */ jsx(
                "div",
                {
                  className: cn(
                    "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                    indicator === "dot" && "items-center"
                  ),
                  children: formatter && item.value !== void 0 && item.name ? formatter(item.value, item.name, item, index3, item.payload) : /* @__PURE__ */ jsxs(Fragment8, { children: [
                    itemConfig?.icon ? /* @__PURE__ */ jsx(itemConfig.icon, {}) : !hideIndicator && /* @__PURE__ */ jsx(
                      "div",
                      {
                        className: cn(
                          "shrink-0 rounded-full",
                          {
                            "h-2 w-2 ring-2 ring-white/20": indicator === "dot",
                            "w-1 rounded-[2px]": indicator === "line",
                            "w-0 border-[1.5px] border-dashed bg-transparent rounded-[2px]": indicator === "dashed",
                            "my-0.5": nestLabel && indicator === "dashed"
                          }
                        ),
                        style: {
                          "--color-bg": indicatorColor,
                          "--color-border": indicatorColor,
                          backgroundColor: indicator === "dot" ? indicatorColor : void 0
                        }
                      }
                    ),
                    /* @__PURE__ */ jsxs(
                      "div",
                      {
                        className: cn(
                          "flex flex-1 justify-between leading-none",
                          nestLabel ? "items-end" : "items-center"
                        ),
                        children: [
                          /* @__PURE__ */ jsxs("div", { className: "grid gap-1.5", children: [
                            nestLabel ? tooltipLabel : null,
                            /* @__PURE__ */ jsx("span", { className: "text-[11px] text-muted-foreground", children: itemConfig?.label || item.name })
                          ] }),
                          item.value != null && /* @__PURE__ */ jsx("span", { className: "ml-auto font-mono text-xs font-semibold tabular-nums text-foreground", children: typeof item.value === "number" ? item.value.toLocaleString() : item.value })
                        ]
                      }
                    )
                  ] })
                },
                item.dataKey
              );
            }) })
          ]
        }
      );
    }
  );
  DesignChartTooltipContent.displayName = "DesignChartTooltipContent";

  // src/components/chart-legend.tsx
  var React58 = __toESM(require_react());
  var RechartsPrimitive3 = __toESM(require_recharts());
  var DesignChartLegend = RechartsPrimitive3.Legend;
  var DesignChartLegendContent = React58.forwardRef(
    ({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey }, ref) => {
      const { config } = useDesignChart();
      if (!payload?.length) {
        return null;
      }
      return /* @__PURE__ */ jsx(
        "div",
        {
          ref,
          className: cn(
            "flex flex-wrap items-center justify-center gap-2",
            verticalAlign === "top" ? "pb-3" : "pt-3",
            className
          ),
          children: payload.map((item) => {
            const key = `${nameKey || item.dataKey || "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            return /* @__PURE__ */ jsxs(
              "div",
              {
                className: cn(
                  "flex items-center gap-1.5 rounded-full bg-foreground/[0.03] ring-1 ring-foreground/[0.06] px-3 py-1.5 text-xs",
                  "transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.05]"
                ),
                children: [
                  itemConfig?.icon && !hideIcon ? /* @__PURE__ */ jsx(itemConfig.icon, {}) : /* @__PURE__ */ jsx(
                    "span",
                    {
                      className: "h-2 w-2 shrink-0 rounded-full",
                      style: { backgroundColor: item.color }
                    }
                  ),
                  /* @__PURE__ */ jsx("span", { className: "font-medium text-foreground", children: itemConfig?.label || item.value })
                ]
              },
              item.value
            );
          })
        }
      );
    }
  );
  DesignChartLegendContent.displayName = "DesignChartLegendContent";

  // src/components/chart-card.tsx
  var hoverTintClasses2 = /* @__PURE__ */ new Map([
    ["blue", "group-hover:bg-blue-500/[0.03]"],
    ["cyan", "group-hover:bg-cyan-500/[0.03]"],
    ["purple", "group-hover:bg-purple-500/[0.03]"],
    ["green", "group-hover:bg-emerald-500/[0.03]"],
    ["orange", "group-hover:bg-orange-500/[0.03]"],
    ["default", "group-hover:bg-slate-500/[0.02]"]
  ]);
  function DesignChartCard({
    gradient = "default",
    title,
    description,
    className,
    children,
    ...props
  }) {
    const hoverTintClass = hoverTintClasses2.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";
    return /* @__PURE__ */ jsxs(Fragment8, { children: [
      /* @__PURE__ */ jsx("style", { dangerouslySetInnerHTML: { __html: `
        .design-chart-card-tooltip-escape .recharts-tooltip-wrapper {
          z-index: 9999 !important;
          overflow: visible !important;
        }
        .design-chart-card-tooltip-escape .recharts-tooltip-wrapper > * {
          overflow: visible !important;
        }
      ` } }),
      /* @__PURE__ */ jsxs(
        "div",
        {
          className: cn(
            "group relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none design-chart-card-tooltip-escape",
            "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
            "shadow-sm hover:shadow-md hover:z-10",
            className
          ),
          ...props,
          children: [
            /* @__PURE__ */ jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" }),
            /* @__PURE__ */ jsx(
              "div",
              {
                className: cn(
                  "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
                  hoverTintClass
                )
              }
            ),
            /* @__PURE__ */ jsxs("div", { className: "relative h-full flex flex-col p-4", children: [
              (title || description) && /* @__PURE__ */ jsxs("div", { className: "mb-3", children: [
                title && /* @__PURE__ */ jsx("h3", { className: "text-sm font-semibold text-foreground", children: title }),
                description && /* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground mt-0.5", children: description })
              ] }),
              children
            ] })
          ]
        }
      )
    ] });
  }

  // src/components/metric-card.tsx
  var hoverTintClasses3 = /* @__PURE__ */ new Map([
    ["blue", "group-hover:bg-blue-500/[0.03]"],
    ["cyan", "group-hover:bg-cyan-500/[0.03]"],
    ["purple", "group-hover:bg-purple-500/[0.03]"],
    ["green", "group-hover:bg-emerald-500/[0.03]"],
    ["orange", "group-hover:bg-orange-500/[0.03]"],
    ["default", "group-hover:bg-slate-500/[0.02]"]
  ]);
  function DesignMetricCard({
    label,
    value,
    description,
    trend,
    icon: Icon,
    gradient = "default",
    className,
    ...props
  }) {
    const hoverTintClass = hoverTintClasses3.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: cn(
          "group relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none overflow-hidden",
          "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
          "shadow-sm hover:shadow-md",
          className
        ),
        ...props,
        children: [
          /* @__PURE__ */ jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl" }),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: cn(
                "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl",
                hoverTintClass
              )
            }
          ),
          /* @__PURE__ */ jsx("div", { className: "relative p-5", children: /* @__PURE__ */ jsx("div", { className: "flex items-start justify-between gap-3", children: /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
            /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
              Icon && /* @__PURE__ */ jsx("div", { className: "p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]", children: /* @__PURE__ */ jsx(Icon, { className: "h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" }) }),
              /* @__PURE__ */ jsx("span", { className: "text-xs font-semibold text-muted-foreground uppercase tracking-wider", children: label })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "mt-3 flex items-baseline gap-2", children: [
              /* @__PURE__ */ jsx("span", { className: "text-3xl font-bold tabular-nums text-foreground", children: typeof value === "number" ? value.toLocaleString() : value }),
              trend && /* @__PURE__ */ jsxs(
                "span",
                {
                  className: cn(
                    "inline-flex items-center gap-0.5 text-xs font-medium",
                    trend.direction === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  ),
                  children: [
                    /* @__PURE__ */ jsx(
                      "svg",
                      {
                        className: cn("h-3 w-3", trend.direction === "down" && "rotate-180"),
                        viewBox: "0 0 12 12",
                        fill: "none",
                        xmlns: "http://www.w3.org/2000/svg",
                        children: /* @__PURE__ */ jsx(
                          "path",
                          {
                            d: "M6 2.5V9.5M6 2.5L3 5.5M6 2.5L9 5.5",
                            stroke: "currentColor",
                            strokeWidth: "1.5",
                            strokeLinecap: "round",
                            strokeLinejoin: "round"
                          }
                        )
                      }
                    ),
                    trend.value,
                    "%",
                    trend.label && /* @__PURE__ */ jsx("span", { className: "text-muted-foreground ml-0.5", children: trend.label })
                  ]
                }
              )
            ] }),
            description && /* @__PURE__ */ jsx("p", { className: "mt-1 text-xs text-muted-foreground", children: description })
          ] }) }) })
        ]
      }
    );
  }

  // src/components/progress-bar.tsx
  var fillClasses = /* @__PURE__ */ new Map([
    ["blue", "bg-blue-500 dark:bg-blue-400"],
    ["cyan", "bg-cyan-500 dark:bg-cyan-400"],
    ["purple", "bg-purple-500 dark:bg-purple-400"],
    ["green", "bg-emerald-500 dark:bg-emerald-400"],
    ["orange", "bg-amber-500 dark:bg-amber-400"],
    ["default", "bg-foreground/60"]
  ]);
  function DesignProgressBar({
    value,
    max: max2 = 100,
    gradient = "default",
    label,
    showPercentage = false,
    size: size5 = "md",
    className
  }) {
    const percentage = max2 > 0 ? Math.min(Math.max(value / max2 * 100, 0), 100) : 0;
    const fillClass = fillClasses.get(gradient) ?? "bg-foreground/60";
    const trackHeight = size5 === "sm" ? "h-1.5" : size5 === "lg" ? "h-3" : "h-2";
    return /* @__PURE__ */ jsxs("div", { className: cn("w-full", className), children: [
      (label || showPercentage) && /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between mb-2", children: [
        label && /* @__PURE__ */ jsx("span", { className: "text-xs font-medium text-muted-foreground", children: label }),
        showPercentage && /* @__PURE__ */ jsxs("span", { className: "text-xs font-medium tabular-nums text-foreground", children: [
          Math.round(percentage),
          "%"
        ] })
      ] }),
      /* @__PURE__ */ jsx(
        "div",
        {
          className: cn(
            "w-full rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden",
            trackHeight
          ),
          children: /* @__PURE__ */ jsx(
            "div",
            {
              className: cn(
                "h-full rounded-full transition-all duration-300 ease-out",
                fillClass
              ),
              style: { width: `${percentage}%` }
            }
          )
        }
      )
    ] });
  }

  // src/components/empty-state.tsx
  function DesignEmptyState({
    icon: Icon,
    title = "No data available",
    description,
    children,
    className
  }) {
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: cn(
          "flex flex-col items-center justify-center py-12 px-6 text-center",
          className
        ),
        children: [
          Icon && /* @__PURE__ */ jsx("div", { className: "mb-4", children: /* @__PURE__ */ jsx(Icon, { className: "h-10 w-10 text-muted-foreground/30" }) }),
          /* @__PURE__ */ jsx("h3", { className: "text-sm font-medium text-foreground", children: title }),
          description && /* @__PURE__ */ jsx("p", { className: "mt-1 text-xs text-muted-foreground max-w-[280px]", children: description }),
          children && /* @__PURE__ */ jsx("div", { className: "mt-4", children })
        ]
      }
    );
  }

  // src/components/grid-layout/types.tsx
  function createWidgetInstance(widget) {
    return {
      id: generateUuid(),
      widget,
      settingsOrUndefined: void 0,
      stateOrUndefined: void 0
    };
  }
  function createErrorWidget(id, errorMessage) {
    return {
      id,
      MainComponent: () => /* @__PURE__ */ jsx(
        "div",
        {
          style: { inset: "0", position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
          children: /* @__PURE__ */ jsx("div", { style: { fontSize: "16px", fontWeight: "bold", color: "red", fontFamily: "monospace", whiteSpace: "pre-wrap" }, children: errorMessage })
        }
      ),
      defaultSettings: null,
      defaultState: null
    };
  }
  function serializeWidgetInstance(widgetInstance) {
    return {
      id: widgetInstance.id,
      widgetId: widgetInstance.widget.id,
      ...widgetInstance.settingsOrUndefined === void 0 ? {} : { settingsOrUndefined: widgetInstance.settingsOrUndefined },
      ...widgetInstance.stateOrUndefined === void 0 ? {} : { stateOrUndefined: widgetInstance.stateOrUndefined }
    };
  }
  function deserializeWidgetInstance(widgets, serialized) {
    const serializedAny = serialized;
    if (typeof serializedAny !== "object" || serializedAny === null) {
      throw new StackAssertionError(`Serialized widget instance is not an object!`, { serialized });
    }
    if (typeof serializedAny.id !== "string") {
      throw new StackAssertionError(`Serialized widget instance id is not a string!`, { serialized });
    }
    return {
      id: serializedAny.id,
      widget: widgets.find((widget) => widget.id === serializedAny.widgetId) ?? createErrorWidget(serializedAny.id, `Widget ${serializedAny.widgetId} not found. Was it deleted?`),
      settingsOrUndefined: serializedAny.settingsOrUndefined,
      stateOrUndefined: serializedAny.stateOrUndefined
    };
  }
  function getSettings(widgetInstance) {
    return widgetInstance.settingsOrUndefined === void 0 ? widgetInstance.widget.defaultSettings : widgetInstance.settingsOrUndefined;
  }
  function getState2(widgetInstance) {
    return widgetInstance.stateOrUndefined === void 0 ? widgetInstance.widget.defaultState : widgetInstance.stateOrUndefined;
  }
  var gridGapPixels = 8;
  var gridUnitHeight = 20;
  var mobileModeWidgetHeight = 384;
  var mobileModeCutoffWidth = 768;

  // ../stack-shared/dist/esm/utils/json.js
  function isJsonSerializable(value) {
    switch (typeof value) {
      case "object":
        if (value === null) return true;
        if (Array.isArray(value)) return value.every(isJsonSerializable);
        return Object.keys(value).every((k) => typeof k === "string") && Object.values(value).every(isJsonSerializable);
      case "string":
      case "number":
      case "boolean":
        return true;
      default:
        return false;
    }
  }

  // src/components/grid-layout/grid-logic.ts
  var _WidgetInstanceGrid = class _WidgetInstanceGrid {
    constructor(_nonEmptyElements, _varHeights, width, _fixedHeight) {
      this._nonEmptyElements = _nonEmptyElements;
      this._varHeights = _varHeights;
      this.width = width;
      this._fixedHeight = _fixedHeight;
      this._elementsCache = null;
      this._as2dArrayCache = null;
      this._clampResizeCache = /* @__PURE__ */ new Map();
      this._canAddVarHeightCache = /* @__PURE__ */ new Map();
      const allInstanceIds = /* @__PURE__ */ new Set();
      const checkInstance = (instance) => {
        if (allInstanceIds.has(instance.id)) {
          throw new StackAssertionError(`Widget instance ${instance.id} is duplicated!`, { instance });
        }
        allInstanceIds.add(instance.id);
        const settings = getSettings(instance);
        const state = getState2(instance);
        if (!isJsonSerializable(settings)) {
          throw new StackAssertionError(`Settings must be JSON serializable`, { instance, settings });
        }
        if (!isJsonSerializable(state)) {
          throw new StackAssertionError(`State must be JSON serializable`, { instance, state });
        }
      };
      for (const element of this._nonEmptyElements) {
        if (element.instance === null) {
          throw new StackAssertionError(`Non-empty element instance is null!`, { element });
        }
        if (element.width < _WidgetInstanceGrid.MIN_ELEMENT_WIDTH) {
          throw new StackAssertionError(`Width must be at least ${_WidgetInstanceGrid.MIN_ELEMENT_WIDTH}`, { width: element.width, element });
        }
        if (element.height < _WidgetInstanceGrid.MIN_ELEMENT_HEIGHT) {
          throw new StackAssertionError(`Height must be at least ${_WidgetInstanceGrid.MIN_ELEMENT_HEIGHT}`, { height: element.height, element });
        }
        if (element.x + element.width > width) {
          throw new StackAssertionError(`Element ${element.instance.id} is out of bounds: ${element.x + element.width} > ${width}`, { width, element });
        }
        if (this._fixedHeight !== "auto" && element.y + element.height > this._fixedHeight) {
          throw new StackAssertionError(`Element ${element.instance.id} is out of bounds: ${element.y + element.height} > ${this._fixedHeight}`, { height: this._fixedHeight, element });
        }
        if (element.instance.widget.isHeightVariable) {
          throw new StackAssertionError(`Element ${element.instance.id} is passed in as a grid element, but has a variable height!`, { element });
        }
        checkInstance(element.instance);
      }
      for (const [y, instances] of this._varHeights) {
        if (instances.length === 0) {
          throw new StackAssertionError(`No variable height widgets found at y = ${y}!`, { varHeights: this._varHeights });
        }
        for (const instance of instances) {
          checkInstance(instance);
        }
      }
    }
    static fromSingleWidgetInstance(widgetInstance) {
      return _WidgetInstanceGrid.fromWidgetInstances([widgetInstance], {
        width: _WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH,
        height: _WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT
      });
    }
    static fromWidgetInstances(widgetInstances, options = {}) {
      const width = options.width ?? 24;
      const height = options.height ?? "auto";
      const elemWidth = options.defaultElementWidth ?? _WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH;
      const elemHeight = options.defaultElementHeight ?? _WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT;
      const nonEmptyElements = widgetInstances.filter((instance) => !instance.widget.isHeightVariable).map((instance, index3) => ({
        instance,
        x: index3 * elemWidth % width,
        y: Math.floor(index3 / Math.floor(width / elemWidth)) * elemHeight,
        width: elemWidth,
        height: elemHeight
      })).sort((a8, b) => Math.sign(a8.x - b.x) + 0.1 * Math.sign(a8.y - b.y));
      const allVarHeightsWidgets = widgetInstances.filter((instance) => instance.widget.isHeightVariable);
      const varHeights = new Map(allVarHeightsWidgets.length === 0 ? [] : [[0, allVarHeightsWidgets]]);
      return new _WidgetInstanceGrid(
        nonEmptyElements,
        varHeights,
        width,
        height
      );
    }
    serialize() {
      const res = {
        className: "WidgetInstanceGrid",
        version: 1,
        width: this.width,
        fixedHeight: this._fixedHeight,
        nonEmptyElements: this._nonEmptyElements.map((element) => ({
          instance: element.instance ? serializeWidgetInstance(element.instance) : null,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height
        })),
        varHeights: [...this._varHeights.entries()].map(([y, instances]) => ({
          y,
          instances: instances.map(serializeWidgetInstance)
        }))
      };
      const afterJsonSerialization = JSON.parse(JSON.stringify(res));
      if (!deepPlainEquals(afterJsonSerialization, res)) {
        throw new StackAssertionError(`WidgetInstanceGrid serialization is not JSON-serializable!`, {
          beforeJsonSerialization: res,
          afterJsonSerialization
        });
      }
      return res;
    }
    static fromSerialized(widgets, serialized) {
      if (typeof serialized !== "object" || serialized === null) {
        throw new StackAssertionError(`WidgetInstanceGrid serialization is not an object or is null!`, { serialized });
      }
      if (!("className" in serialized) || typeof serialized.className !== "string" || serialized.className !== "WidgetInstanceGrid") {
        throw new StackAssertionError(`WidgetInstanceGrid serialization is not a WidgetInstanceGrid!`, { serialized });
      }
      const serializedAny = serialized;
      switch (serializedAny.version) {
        case 1: {
          const nonEmptyElements = serializedAny.nonEmptyElements.map((element) => ({
            instance: element.instance ? deserializeWidgetInstance(widgets, element.instance) : null,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height
          }));
          const varHeights = new Map(serializedAny.varHeights.map((entry) => [entry.y, entry.instances.map((serialized2) => deserializeWidgetInstance(widgets, serialized2))]));
          return new _WidgetInstanceGrid(nonEmptyElements, varHeights, serializedAny.width, serializedAny.fixedHeight);
        }
        default: {
          throw new StackAssertionError(`Unknown WidgetInstanceGrid version ${serializedAny.version}!`, {
            serialized
          });
        }
      }
    }
    get height() {
      if (this._fixedHeight === "auto") {
        return Math.max(0, ...[...this._nonEmptyElements].map(({ y, height }) => y + height)) + 1;
      } else {
        return this._fixedHeight;
      }
    }
    static _withEmptyElements(array2, varHeights, nonEmptyElements) {
      let result = [...nonEmptyElements];
      const newArray = array2.map((row) => [...row]);
      for (let x1 = 0; x1 < array2.length; x1++) {
        for (let y1 = 0; y1 < array2[x1].length; y1++) {
          if (newArray[x1][y1] === null) {
            let x2 = x1 + 1;
            while (x2 < array2.length && x2 - x1 < _WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH) {
              if (newArray[x2][y1] !== null) {
                break;
              }
              x2++;
            }
            let y2 = y1 + 1;
            outer: while (y2 < array2[x1].length && y2 - y1 < _WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT) {
              if (varHeights.has(y2)) {
                break outer;
              }
              for (let xx = x1; xx < x2; xx++) {
                if (newArray[xx][y2] !== null) {
                  break outer;
                }
              }
              y2++;
            }
            result.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, instance: null });
            for (let xx = x1; xx < x2; xx++) {
              for (let yy = y1; yy < y2; yy++) {
                newArray[xx][yy] = "empty";
              }
            }
          }
        }
      }
      return result;
    }
    elements() {
      if (this._elementsCache === null) {
        this._elementsCache = _WidgetInstanceGrid._withEmptyElements(this.as2dArray(), this._varHeights, this._nonEmptyElements);
      }
      return this._elementsCache;
    }
    varHeights() {
      return this._varHeights;
    }
    as2dArray() {
      if (this._as2dArrayCache !== null) {
        return this._as2dArrayCache;
      }
      const array2 = new Array(this.width).fill(null).map(() => new Array(this.height).fill(null));
      [...this._nonEmptyElements].forEach(({ x, y, width, height, instance }) => {
        if (x + width > this.width) {
          throw new StackAssertionError(`Widget instance ${instance?.id} is out of bounds: ${x + width} > ${this.width}`);
        }
        for (let i = 0; i < width; i++) {
          for (let j = 0; j < height; j++) {
            array2[x + i][y + j] = instance;
          }
        }
      });
      return this._as2dArrayCache = array2;
    }
    getElementAt(x, y) {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
        throw new StackAssertionError(`Invalid coordinates for getElementAt: ${x}, ${y}`);
      }
      return [...this.elements()].find((element) => x >= element.x && x < element.x + element.width && y >= element.y && y < element.y + element.height) ?? throwErr(`No element found at ${x}, ${y}`);
    }
    getElementByInstanceId(id) {
      return [...this.elements()].find((element) => element.instance?.id === id) ?? null;
    }
    getInstanceById(id) {
      const element = this.getElementByInstanceId(id);
      if (element?.instance) return element.instance;
      const varHeight = this.getVarHeightInstanceById(id);
      if (varHeight) return varHeight;
      return null;
    }
    getMinResizableSize() {
      return {
        width: Math.max(1, ...[...this._nonEmptyElements].map(({ x, width }) => x + width)),
        height: Math.max(1, ...[...this._nonEmptyElements].map(({ y, height }) => y + height))
      };
    }
    resize(width, height) {
      if (this.width === width && this._fixedHeight === height) {
        return this;
      }
      const minSize = this.getMinResizableSize();
      if (width < minSize.width) {
        throw new StackAssertionError(`Width must be at least ${minSize.width}`, { width });
      }
      if (height !== "auto" && height < minSize.height) {
        throw new StackAssertionError(`Height must be at least ${minSize.height}`, { height });
      }
      return new _WidgetInstanceGrid(this._nonEmptyElements, this._varHeights, width, height);
    }
    elementMinSize(element) {
      const res = { width: _WidgetInstanceGrid.MIN_ELEMENT_WIDTH, height: _WidgetInstanceGrid.MIN_ELEMENT_HEIGHT };
      if (element.instance?.widget.minWidth != null) {
        res.width = Math.max(res.width, element.instance.widget.minWidth);
      }
      if (element.instance?.widget.minHeight != null) {
        res.height = Math.max(res.height, element.instance.widget.minHeight);
      }
      if (element.instance?.widget.calculateMinSize) {
        const minSize = element.instance.widget.calculateMinSize({ settings: element.instance.settingsOrUndefined, state: element.instance.stateOrUndefined });
        if (minSize.widthInGridUnits > element.width || minSize.heightInGridUnits > element.height) {
          throw new StackAssertionError(`Widget ${element.instance.widget.id} has a size of ${element.width}x${element.height}, but calculateMinSize returned a smaller value (${minSize.widthInGridUnits}x${minSize.heightInGridUnits}).`);
        }
        res.width = Math.max(res.width, minSize.widthInGridUnits);
        res.height = Math.max(res.height, minSize.heightInGridUnits);
      }
      return res;
    }
    /**
     * Returns true iff the element can be fit at the given position and size, even if there are other elements in the
     * way.
     */
    _canFitSize(element, x, y, width, height) {
      if (x < 0 || x + width > this.width || y < 0 || y + height > this.height) {
        return false;
      }
      const minSize = this.elementMinSize(element);
      if (width < minSize.width || height < minSize.height) {
        return false;
      }
      return true;
    }
    canSwap(x1, y1, x2, y2) {
      const elementsToSwap = [this.getElementAt(x1, y1), this.getElementAt(x2, y2)];
      return elementsToSwap[0].instance !== null || elementsToSwap[1].instance !== null;
    }
    withSwappedElements(x1, y1, x2, y2) {
      if (!this.canSwap(x1, y1, x2, y2)) {
        throw new StackAssertionError(`Cannot swap elements at ${x1}, ${y1} and ${x2}, ${y2}`);
      }
      const elementsToSwap = [this.getElementAt(x1, y1), this.getElementAt(x2, y2)];
      const newElements = [...this.elements()].map((element) => {
        if (element.x === elementsToSwap[0].x && element.y === elementsToSwap[0].y) {
          return { ...element, instance: elementsToSwap[1].instance };
        }
        if (element.x === elementsToSwap[1].x && element.y === elementsToSwap[1].y) {
          return { ...element, instance: elementsToSwap[0].instance };
        }
        return element;
      });
      return new _WidgetInstanceGrid(newElements.filter((element) => element.instance !== null), this._varHeights, this.width, this._fixedHeight);
    }
    /**
     * Swaps two elements fully: each element takes the other's position AND size.
     */
    withFullySwappedElements(x1, y1, x2, y2) {
      if (!this.canSwap(x1, y1, x2, y2)) {
        throw new StackAssertionError(`Cannot fully swap elements at ${x1}, ${y1} and ${x2}, ${y2}`);
      }
      const el0 = this.getElementAt(x1, y1);
      const el1 = this.getElementAt(x2, y2);
      const newElements = [...this.elements()].map((element) => {
        if (element.x === el0.x && element.y === el0.y) {
          return { instance: el0.instance, x: el1.x, y: el1.y, width: el1.width, height: el1.height };
        }
        if (element.x === el1.x && element.y === el1.y) {
          return { instance: el1.instance, x: el0.x, y: el0.y, width: el0.width, height: el0.height };
        }
        return element;
      });
      return new _WidgetInstanceGrid(newElements.filter((element) => element.instance !== null), this._varHeights, this.width, this._fixedHeight);
    }
    static _rectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
      return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
    }
    /**
     * Moves an element to a new position (keeping its original size).
     * Displaced elements are placed at the nearest available position,
     * preferring horizontal shifts on the same row before pushing down.
     */
    withMovedElementTo(fromX, fromY, toX, toY) {
      const element = this.getElementAt(fromX, fromY);
      if (!element.instance) return this;
      const newX = Math.max(0, Math.min(toX, this.width - element.width));
      const newY = Math.max(0, toY);
      if (newX === element.x && newY === element.y) return this;
      const movedElement = { ...element, x: newX, y: newY };
      const otherElements = this._nonEmptyElements.filter(
        (e15) => e15.instance?.id !== element.instance?.id
      );
      const sorted = [...otherElements].sort((a8, b) => a8.y - b.y || a8.x - b.x);
      const placed = [movedElement];
      for (const el of sorted) {
        const overlaps = placed.some(
          (p2) => _WidgetInstanceGrid._rectsOverlap(el.x, el.y, el.width, el.height, p2.x, p2.y, p2.width, p2.height)
        );
        if (!overlaps) {
          placed.push(el);
          continue;
        }
        const best = _WidgetInstanceGrid._findNearestAvailablePosition(el, placed, this.width);
        placed.push({ ...el, x: best.x, y: best.y });
      }
      let newFixedHeight = this._fixedHeight;
      if (newFixedHeight !== "auto") {
        for (const p2 of placed) {
          if (p2.y + p2.height > newFixedHeight) {
            newFixedHeight = p2.y + p2.height;
          }
        }
      }
      return new _WidgetInstanceGrid(placed, this._varHeights, this.width, newFixedHeight);
    }
    /**
     * Finds the nearest available (non-overlapping) position for an element,
     * preferring horizontal shifts on the same row before trying rows below.
     */
    static _findNearestAvailablePosition(el, placed, gridWidth) {
      const fits = (tryX, tryY) => {
        if (tryX < 0 || tryX + el.width > gridWidth) return false;
        return placed.every(
          (p2) => !_WidgetInstanceGrid._rectsOverlap(tryX, tryY, el.width, el.height, p2.x, p2.y, p2.width, p2.height)
        );
      };
      for (let dy = 0; dy < 50; dy++) {
        const tryY = el.y + dy;
        for (let dx = 0; dx <= gridWidth; dx++) {
          if (fits(el.x + dx, tryY)) return { x: el.x + dx, y: tryY };
          if (dx !== 0 && fits(el.x - dx, tryY)) return { x: el.x - dx, y: tryY };
        }
      }
      const maxY = Math.max(0, ...placed.map((p2) => p2.y + p2.height));
      return { x: el.x, y: maxY };
    }
    /**
     * Given four edge resize deltas (for top/left/bottom/right edges), returns deltas that are smaller or the same as the
     * input deltas, would prevent any collisions with other elements. If there are multiple possible return values,
     * returns any one such that it can not be increased in any dimension.
     *
     * For example, if the element is at (2, 2) with width 1 and height 1, and the edgesDelta is
     * { top: 1, left: 1, bottom: 1, right: 1 }, then the new element would be at (3, 3) with width 1 and height 1.
     * However, if there is already an element at (3, 3), then this function would return
     * { top: 0, left: 1, bottom: 0, right: 1 } or { top: 1, left: 0, bottom: 1, right: 0 }.
     *
     */
    clampElementResize(x, y, edgesDelta) {
      const elementToResize = this.getElementAt(x, y);
      const cacheKey = `${elementToResize.x},${elementToResize.y},${JSON.stringify(edgesDelta)}`;
      if (!this._clampResizeCache.has(cacheKey)) {
        const array2 = this.as2dArray();
        const newX = elementToResize.x + edgesDelta.left;
        const newY = elementToResize.y + edgesDelta.top;
        const newWidth = elementToResize.width - edgesDelta.left + edgesDelta.right;
        const newHeight = elementToResize.height - edgesDelta.top + edgesDelta.bottom;
        const minSize = this.elementMinSize(elementToResize);
        let isAllowed = false;
        if (newWidth >= minSize.width && newHeight >= minSize.height && newX >= 0 && newY >= 0 && newX + newWidth <= this.width && newY + newHeight <= this.height) {
          isAllowed = true;
          outer: for (let i = 0; i < newWidth; i++) {
            for (let j = 0; j < newHeight; j++) {
              if (array2[newX + i][newY + j] !== null && array2[newX + i][newY + j] !== elementToResize.instance) {
                isAllowed = false;
                break outer;
              }
            }
          }
        }
        if (isAllowed) {
          this._clampResizeCache.set(cacheKey, edgesDelta);
        } else {
          const decr = (i) => i > 0 ? i - 1 : i < 0 ? i + 1 : i;
          const candidates = [
            edgesDelta.top !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, top: decr(edgesDelta.top) }) : null,
            edgesDelta.left !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, left: decr(edgesDelta.left) }) : null,
            edgesDelta.bottom !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, bottom: decr(edgesDelta.bottom) }) : null,
            edgesDelta.right !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, right: decr(edgesDelta.right) }) : null
          ].filter(isNotNull);
          let maxScore = 0;
          let bestCandidate = { top: 0, left: 0, bottom: 0, right: 0 };
          for (const candidate of candidates) {
            const score = Math.abs(candidate.top) + Math.abs(candidate.left) + Math.abs(candidate.bottom) + Math.abs(candidate.right);
            if (score > maxScore) {
              maxScore = score;
              bestCandidate = candidate;
            }
          }
          this._clampResizeCache.set(cacheKey, bestCandidate);
        }
      }
      return this._clampResizeCache.get(cacheKey);
    }
    withResizedElement(x, y, edgesDelta) {
      const clamped = this.clampElementResize(x, y, edgesDelta);
      if (!deepPlainEquals(clamped, edgesDelta)) {
        throw new StackAssertionError(`Resize is not allowed: ${JSON.stringify(edgesDelta)} requested, but only ${JSON.stringify(clamped)} allowed`);
      }
      if (clamped.top === 0 && clamped.left === 0 && clamped.bottom === 0 && clamped.right === 0) return this;
      const elementToResize = this.getElementAt(x, y);
      const newNonEmptyElements = [...this._nonEmptyElements].map((element) => {
        if (element.x === elementToResize.x && element.y === elementToResize.y) {
          return {
            ...element,
            x: element.x + clamped.left,
            y: element.y + clamped.top,
            width: element.width - clamped.left + clamped.right,
            height: element.height - clamped.top + clamped.bottom
          };
        }
        return element;
      });
      return new _WidgetInstanceGrid(newNonEmptyElements, this._varHeights, this.width, this._fixedHeight);
    }
    /**
     * Resizes an element and pushes neighboring elements horizontally to make room.
     * When growing right, neighbors to the right are shrunk from their left edge.
     * When growing left, neighbors to the left are shrunk from their right edge.
     * Vertical resize uses normal clamping (no push).
     */
    withResizedElementAndPush(x, y, requestedDelta) {
      const element = this.getElementAt(x, y);
      if (!element.instance) {
        return { grid: this, achievedDelta: { top: 0, left: 0, bottom: 0, right: 0 }, blocked: { top: false, left: false, right: false, bottom: false } };
      }
      const vertDelta = { top: requestedDelta.top, left: 0, bottom: 0, right: 0 };
      const clampedVert = this.clampElementResize(x, y, vertDelta);
      const blockedTop = requestedDelta.top !== 0 && clampedVert.top !== requestedDelta.top;
      const array2 = this.as2dArray();
      let achievedBottom = requestedDelta.bottom;
      const blockedBottom = false;
      if (achievedBottom < 0) {
        const minSize = this.elementMinSize(element);
        const newHeight = element.height + achievedBottom;
        if (newHeight < minSize.height) {
          achievedBottom = minSize.height - element.height;
        }
      }
      let achievedRight = requestedDelta.right;
      let achievedLeft = requestedDelta.left;
      let blockedRight = false;
      let blockedLeft = false;
      if (achievedRight > 0) {
        achievedRight = Math.min(achievedRight, this.width - element.x - element.width);
        if (achievedRight > 0) {
          for (let row = element.y; row < element.y + element.height && row < this.height; row++) {
            for (let col = element.x + element.width; col < element.x + element.width + achievedRight && col < this.width; col++) {
              const occ = array2[col][row];
              if (occ && occ !== element.instance) {
                const blocker = this.getElementByInstanceId(occ.id);
                if (blocker?.instance) {
                  achievedRight = Math.min(achievedRight, Math.max(0, blocker.x - element.x - element.width));
                  blockedRight = true;
                }
              }
            }
          }
        }
        if (achievedRight === 0 && requestedDelta.right > 0) {
          const nextCol = element.x + element.width;
          if (nextCol >= this.width) {
            blockedRight = true;
          } else {
            for (let row = element.y; row < element.y + element.height && row < this.height; row++) {
              const occ = array2[nextCol][row];
              if (occ && occ !== element.instance) {
                blockedRight = true;
                break;
              }
            }
          }
        }
        achievedRight = Math.max(0, achievedRight);
      }
      if (achievedLeft < 0) {
        achievedLeft = Math.max(achievedLeft, -element.x);
        if (achievedLeft < 0) {
          for (let row = element.y; row < element.y + element.height && row < this.height; row++) {
            for (let col = element.x + achievedLeft; col < element.x && col >= 0; col++) {
              const occ = array2[col][row];
              if (occ && occ !== element.instance) {
                const blocker = this.getElementByInstanceId(occ.id);
                if (blocker?.instance) {
                  achievedLeft = Math.max(achievedLeft, Math.min(0, -(element.x - (blocker.x + blocker.width))));
                  blockedLeft = true;
                }
              }
            }
          }
        }
        if (achievedLeft === 0 && requestedDelta.left < 0) {
          const prevCol = element.x - 1;
          if (prevCol < 0) {
            blockedLeft = true;
          } else {
            for (let row = element.y; row < element.y + element.height && row < this.height; row++) {
              const occ = array2[prevCol][row];
              if (occ && occ !== element.instance) {
                blockedLeft = true;
                break;
              }
            }
          }
        }
        achievedLeft = Math.min(0, achievedLeft);
      }
      const elementMinWidth = this.elementMinSize(element).width;
      const newWidth = element.width - achievedLeft + achievedRight;
      if (newWidth < elementMinWidth) {
        return { grid: this, achievedDelta: { top: 0, left: 0, bottom: 0, right: 0 }, blocked: { top: blockedTop, left: blockedLeft, right: blockedRight, bottom: blockedBottom } };
      }
      const achievedDelta = {
        top: clampedVert.top,
        left: achievedLeft,
        bottom: achievedBottom,
        right: achievedRight
      };
      if (achievedDelta.top === 0 && achievedDelta.left === 0 && achievedDelta.bottom === 0 && achievedDelta.right === 0) {
        return { grid: this, achievedDelta, blocked: { top: blockedTop, left: blockedLeft, right: blockedRight, bottom: blockedBottom } };
      }
      const resizedElement = {
        ...element,
        x: element.x + achievedDelta.left,
        y: element.y + achievedDelta.top,
        width: element.width - achievedDelta.left + achievedDelta.right,
        height: element.height - achievedDelta.top + achievedDelta.bottom
      };
      const newElements = [resizedElement];
      const others = this._nonEmptyElements.filter((el) => el.instance?.id !== element.instance?.id).sort((a8, b) => a8.y - b.y || a8.x - b.x);
      for (const el of others) {
        let pushed = { ...el };
        let changed = true;
        while (changed) {
          changed = false;
          for (const placed of newElements) {
            if (_WidgetInstanceGrid._rectsOverlap(
              pushed.x,
              pushed.y,
              pushed.width,
              pushed.height,
              placed.x,
              placed.y,
              placed.width,
              placed.height
            )) {
              pushed = { ...pushed, y: placed.y + placed.height };
              changed = true;
            }
          }
        }
        newElements.push(pushed);
      }
      try {
        let newFixedHeight = this._fixedHeight;
        if (newFixedHeight !== "auto") {
          for (const el of newElements) {
            if (el.y + el.height > newFixedHeight) {
              newFixedHeight = el.y + el.height;
            }
          }
        }
        const newGrid = new _WidgetInstanceGrid(newElements, this._varHeights, this.width, newFixedHeight);
        return { grid: newGrid, achievedDelta, blocked: { top: blockedTop, left: blockedLeft, right: blockedRight, bottom: blockedBottom } };
      } catch {
        const clamped = this.clampElementResize(x, y, requestedDelta);
        if (clamped.top === 0 && clamped.left === 0 && clamped.bottom === 0 && clamped.right === 0) {
          return { grid: this, achievedDelta: clamped, blocked: { top: blockedTop, left: blockedLeft, right: blockedRight, bottom: blockedBottom } };
        }
        try {
          return { grid: this.withResizedElement(x, y, clamped), achievedDelta: clamped, blocked: { top: blockedTop, left: blockedLeft, right: blockedRight, bottom: blockedBottom } };
        } catch {
          return { grid: this, achievedDelta: { top: 0, left: 0, bottom: 0, right: 0 }, blocked: { top: blockedTop, left: blockedLeft, right: blockedRight, bottom: blockedBottom } };
        }
      }
    }
    withAddedElement(widget, x, y, width, height) {
      const newNonEmptyElements = [...this._nonEmptyElements, {
        instance: createWidgetInstance(widget),
        x,
        y,
        width,
        height
      }];
      return new _WidgetInstanceGrid(newNonEmptyElements, this._varHeights, this.width, this._fixedHeight);
    }
    withAddedElementInstance(instance, x, y, width, height) {
      const newNonEmptyElements = [...this._nonEmptyElements, { instance, x, y, width, height }];
      return new _WidgetInstanceGrid(newNonEmptyElements, this._varHeights, this.width, this._fixedHeight);
    }
    _withUpdatedElementInstance(x, y, updater) {
      const elementToUpdate = this.getElementAt(x, y);
      const newNonEmptyElements = this._nonEmptyElements.map((element) => element.x === elementToUpdate.x && element.y === elementToUpdate.y ? { ...element, instance: updater(element) } : element).filter((element) => element.instance !== null);
      return new _WidgetInstanceGrid(newNonEmptyElements, this._varHeights, this.width, this._fixedHeight);
    }
    withRemovedElement(x, y) {
      return this._withUpdatedElementInstance(x, y, () => null);
    }
    withUpdatedElementSettings(x, y, newSettings) {
      if (!isJsonSerializable(newSettings)) {
        throw new StackAssertionError(`New settings are not JSON serializable: ${JSON.stringify(newSettings)}`, { newSettings });
      }
      return this._withUpdatedElementInstance(x, y, (element) => element.instance ? { ...element.instance, settingsOrUndefined: newSettings } : throwErr(`No widget instance at ${x}, ${y}`));
    }
    withUpdatedElementState(x, y, newState) {
      if (!isJsonSerializable(newState)) {
        throw new StackAssertionError(`New state are not JSON serializable: ${JSON.stringify(newState)}`, { newState });
      }
      return this._withUpdatedElementInstance(x, y, (element) => element.instance ? { ...element.instance, stateOrUndefined: newState } : throwErr(`No widget instance at ${x}, ${y}`));
    }
    getVarHeightInstanceById(id) {
      return [...this.varHeights()].flatMap(([_, instances]) => instances).find((instance) => instance.id === id);
    }
    _withUpdatedVarHeightInstance(oldId, updater) {
      const newVarHeights = new Map(
        [...this.varHeights()].map(([y, inst]) => [y, inst.map((i) => i.id === oldId ? updater(i) : i)])
      );
      return new _WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
    }
    withUpdatedVarHeightSettings(instanceId, newSettingsOrUndefined) {
      return this._withUpdatedVarHeightInstance(instanceId, (instance) => ({ ...instance, settingsOrUndefined: newSettingsOrUndefined }));
    }
    withUpdatedVarHeightState(instanceId, newStateOrUndefined) {
      return this._withUpdatedVarHeightInstance(instanceId, (instance) => ({ ...instance, stateOrUndefined: newStateOrUndefined }));
    }
    withRemovedVarHeight(instanceId) {
      const newVarHeights = new Map(
        [...this.varHeights()].map(([y, inst]) => [y, inst.filter((i) => i.id !== instanceId)]).filter(([_, inst]) => inst.length > 0)
      );
      return new _WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
    }
    canAddVarHeight(y) {
      if (this._canAddVarHeightCache.has(y)) {
        return this._canAddVarHeightCache.get(y);
      }
      let result = true;
      for (const element of this.elements()) {
        if (element.y < y && element.y + element.height > y) {
          result = false;
          break;
        }
      }
      this._canAddVarHeightCache.set(y, result);
      return result;
    }
    withAddedVarHeightWidget(y, widget) {
      return this.withAddedVarHeightAtEndOf(y, createWidgetInstance(widget));
    }
    withAddedVarHeightAtEndOf(y, instance) {
      if (!this.canAddVarHeight(y)) {
        throw new StackAssertionError(`Cannot add var height instance at ${y}`, { y, instance });
      }
      const newVarHeights = new Map(this._varHeights);
      newVarHeights.set(y, [...newVarHeights.get(y) ?? [], instance]);
      return new _WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
    }
    withAddedVarHeightAtInstance(instance, toInstanceId, beforeOrAfter) {
      const newVarHeights = new Map(
        [...this.varHeights()].map(([y, inst]) => [
          y,
          inst.flatMap((i) => i.id === toInstanceId ? beforeOrAfter === "before" ? [instance, i] : [i, instance] : [i])
        ])
      );
      return new _WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
    }
    withMovedVarHeightToInstance(oldId, toInstanceId, beforeOrAfter) {
      if (toInstanceId === oldId) {
        return this;
      }
      const instance = this.getVarHeightInstanceById(oldId) ?? throwErr(`Widget instance ${oldId} not found in var heights`, { oldId });
      return this.withRemovedVarHeight(oldId).withAddedVarHeightAtInstance(instance, toInstanceId, beforeOrAfter);
    }
    withMovedVarHeightToEndOf(oldId, toY) {
      const instance = this.getVarHeightInstanceById(oldId) ?? throwErr(`Widget instance ${oldId} not found in var heights`, { oldId });
      return this.withRemovedVarHeight(oldId).withAddedVarHeightAtEndOf(toY, instance);
    }
  };
  _WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH = 12;
  _WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT = 8;
  _WidgetInstanceGrid.MIN_ELEMENT_WIDTH = 4;
  _WidgetInstanceGrid.MIN_ELEMENT_HEIGHT = 2;
  var WidgetInstanceGrid = _WidgetInstanceGrid;

  // src/components/grid-layout/resize-handle.tsx
  var import_react26 = __toESM(require_react());
  function ResizeHandle({ widgetInstance, x, y, ...props }) {
    const dragBaseCoordinates = useRefState(null);
    if (![-1, 0, 1].includes(x) || ![-1, 0, 1].includes(y)) {
      throw new StackAssertionError(`Invalid resize handle coordinates, must be -1, 0, or 1: ${x}, ${y}`);
    }
    const isCorner = x !== 0 && y !== 0;
    (0, import_react26.useEffect)(() => {
      const onMouseMove = (event) => {
        if (!dragBaseCoordinates.current) return;
        const pixelDelta = [event.clientX - dragBaseCoordinates.current[0], event.clientY - dragBaseCoordinates.current[1]];
        const { width: unitWidth, height: unitHeight } = calculateUnitSizeRef.current();
        const unitDelta = [Math.round(pixelDelta[0] / unitWidth), Math.round(pixelDelta[1] / unitHeight)];
        if (unitDelta[0] !== 0 || unitDelta[1] !== 0) {
          const resizeResult = onResizeRef.current({
            top: y === -1 ? unitDelta[1] : 0,
            left: x === -1 ? unitDelta[0] : 0,
            bottom: y === 1 ? unitDelta[1] : 0,
            right: x === 1 ? unitDelta[0] : 0
          });
          dragBaseCoordinates.set([
            dragBaseCoordinates.current[0] + (resizeResult.left + resizeResult.right) * unitWidth,
            dragBaseCoordinates.current[1] + (resizeResult.top + resizeResult.bottom) * unitHeight
          ]);
        }
      };
      window.addEventListener("mousemove", onMouseMove);
      return () => {
        window.removeEventListener("mousemove", onMouseMove);
      };
    }, [x, y, props.onResize, props.calculateUnitSize, dragBaseCoordinates]);
    const onResizeRef = (0, import_react26.useRef)(props.onResize);
    onResizeRef.current = props.onResize;
    const calculateUnitSizeRef = (0, import_react26.useRef)(props.calculateUnitSize);
    calculateUnitSizeRef.current = props.calculateUnitSize;
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: "border-black dark:border-white",
        style: {
          position: "absolute",
          zIndex: 100,
          left: x === -1 ? "-3px" : x === 0 ? "50%" : void 0,
          top: y === -1 ? "-3px" : y === 0 ? "50%" : void 0,
          right: x === 1 ? "-3px" : void 0,
          bottom: y === 1 ? "-3px" : void 0,
          transform: `translate(${x === 0 ? "-50%" : 0}, ${y === 0 ? "-50%" : 0})`,
          width: "36px",
          height: "36px",
          opacity: 0.8,
          borderWidth: "6px",
          borderTopStyle: y === -1 ? "solid" : "none",
          borderRightStyle: x === 1 ? "solid" : "none",
          borderBottomStyle: y === 1 ? "solid" : "none",
          borderLeftStyle: x === -1 ? "solid" : "none",
          borderTopLeftRadius: x === -1 && y === -1 ? "16px" : void 0,
          borderTopRightRadius: x === 1 && y === -1 ? "16px" : void 0,
          borderBottomLeftRadius: x === -1 && y === 1 ? "16px" : void 0,
          borderBottomRightRadius: x === 1 && y === 1 ? "16px" : void 0,
          cursor: isCorner ? x === y ? "nwse-resize" : "nesw-resize" : x === 0 ? "ns-resize" : "ew-resize"
        },
        onMouseDown: (event) => {
          dragBaseCoordinates.set([event.clientX, event.clientY]);
          window.addEventListener("mouseup", () => {
            dragBaseCoordinates.set(null);
          }, { once: true });
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }
    );
  }

  // ../../node_modules/.pnpm/@dnd-kit+core@6.3.1_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@dnd-kit/core/dist/core.esm.js
  var import_react29 = __toESM(require_react());
  var import_react_dom6 = __toESM(require_react_dom());

  // ../../node_modules/.pnpm/@dnd-kit+utilities@3.2.2_react@19.2.3/node_modules/@dnd-kit/utilities/dist/utilities.esm.js
  var import_react27 = __toESM(require_react());
  var canUseDOM2 = typeof window !== "undefined" && typeof window.document !== "undefined" && typeof window.document.createElement !== "undefined";
  function isWindow(element) {
    const elementString = Object.prototype.toString.call(element);
    return elementString === "[object Window]" || // In Electron context the Window object serializes to [object global]
    elementString === "[object global]";
  }
  function isNode2(node) {
    return "nodeType" in node;
  }
  function getWindow2(target) {
    var _target$ownerDocument, _target$ownerDocument2;
    if (!target) {
      return window;
    }
    if (isWindow(target)) {
      return target;
    }
    if (!isNode2(target)) {
      return window;
    }
    return (_target$ownerDocument = (_target$ownerDocument2 = target.ownerDocument) == null ? void 0 : _target$ownerDocument2.defaultView) != null ? _target$ownerDocument : window;
  }
  function isDocument(node) {
    const {
      Document
    } = getWindow2(node);
    return node instanceof Document;
  }
  function isHTMLElement2(node) {
    if (isWindow(node)) {
      return false;
    }
    return node instanceof getWindow2(node).HTMLElement;
  }
  function isSVGElement(node) {
    return node instanceof getWindow2(node).SVGElement;
  }
  function getOwnerDocument(target) {
    if (!target) {
      return document;
    }
    if (isWindow(target)) {
      return target.document;
    }
    if (!isNode2(target)) {
      return document;
    }
    if (isDocument(target)) {
      return target;
    }
    if (isHTMLElement2(target) || isSVGElement(target)) {
      return target.ownerDocument;
    }
    return document;
  }
  var useIsomorphicLayoutEffect2 = canUseDOM2 ? import_react27.useLayoutEffect : import_react27.useEffect;
  function useEvent(handler) {
    const handlerRef = (0, import_react27.useRef)(handler);
    useIsomorphicLayoutEffect2(() => {
      handlerRef.current = handler;
    });
    return (0, import_react27.useCallback)(function() {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      return handlerRef.current == null ? void 0 : handlerRef.current(...args);
    }, []);
  }
  function useInterval() {
    const intervalRef = (0, import_react27.useRef)(null);
    const set = (0, import_react27.useCallback)((listener, duration) => {
      intervalRef.current = setInterval(listener, duration);
    }, []);
    const clear = (0, import_react27.useCallback)(() => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, []);
    return [set, clear];
  }
  function useLatestValue(value, dependencies) {
    if (dependencies === void 0) {
      dependencies = [value];
    }
    const valueRef = (0, import_react27.useRef)(value);
    useIsomorphicLayoutEffect2(() => {
      if (valueRef.current !== value) {
        valueRef.current = value;
      }
    }, dependencies);
    return valueRef;
  }
  function useLazyMemo(callback, dependencies) {
    const valueRef = (0, import_react27.useRef)();
    return (0, import_react27.useMemo)(
      () => {
        const newValue = callback(valueRef.current);
        valueRef.current = newValue;
        return newValue;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [...dependencies]
    );
  }
  function useNodeRef(onChange) {
    const onChangeHandler = useEvent(onChange);
    const node = (0, import_react27.useRef)(null);
    const setNodeRef = (0, import_react27.useCallback)(
      (element) => {
        if (element !== node.current) {
          onChangeHandler == null ? void 0 : onChangeHandler(element, node.current);
        }
        node.current = element;
      },
      //eslint-disable-next-line
      []
    );
    return [node, setNodeRef];
  }
  function usePrevious(value) {
    const ref = (0, import_react27.useRef)();
    (0, import_react27.useEffect)(() => {
      ref.current = value;
    }, [value]);
    return ref.current;
  }
  var ids = {};
  function useUniqueId(prefix, value) {
    return (0, import_react27.useMemo)(() => {
      if (value) {
        return value;
      }
      const id = ids[prefix] == null ? 0 : ids[prefix] + 1;
      ids[prefix] = id;
      return prefix + "-" + id;
    }, [prefix, value]);
  }
  function createAdjustmentFn(modifier) {
    return function(object2) {
      for (var _len = arguments.length, adjustments = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        adjustments[_key - 1] = arguments[_key];
      }
      return adjustments.reduce((accumulator, adjustment) => {
        const entries = Object.entries(adjustment);
        for (const [key, valueAdjustment] of entries) {
          const value = accumulator[key];
          if (value != null) {
            accumulator[key] = value + modifier * valueAdjustment;
          }
        }
        return accumulator;
      }, {
        ...object2
      });
    };
  }
  var add = /* @__PURE__ */ createAdjustmentFn(1);
  var subtract = /* @__PURE__ */ createAdjustmentFn(-1);
  function hasViewportRelativeCoordinates(event) {
    return "clientX" in event && "clientY" in event;
  }
  function isKeyboardEvent(event) {
    if (!event) {
      return false;
    }
    const {
      KeyboardEvent
    } = getWindow2(event.target);
    return KeyboardEvent && event instanceof KeyboardEvent;
  }
  function isTouchEvent(event) {
    if (!event) {
      return false;
    }
    const {
      TouchEvent
    } = getWindow2(event.target);
    return TouchEvent && event instanceof TouchEvent;
  }
  function getEventCoordinates(event) {
    if (isTouchEvent(event)) {
      if (event.touches && event.touches.length) {
        const {
          clientX: x,
          clientY: y
        } = event.touches[0];
        return {
          x,
          y
        };
      } else if (event.changedTouches && event.changedTouches.length) {
        const {
          clientX: x,
          clientY: y
        } = event.changedTouches[0];
        return {
          x,
          y
        };
      }
    }
    if (hasViewportRelativeCoordinates(event)) {
      return {
        x: event.clientX,
        y: event.clientY
      };
    }
    return null;
  }
  var SELECTOR = "a,frame,iframe,input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),*[tabindex]";
  function findFirstFocusableNode(element) {
    if (element.matches(SELECTOR)) {
      return element;
    }
    return element.querySelector(SELECTOR);
  }

  // ../../node_modules/.pnpm/@dnd-kit+accessibility@3.1.1_react@19.2.3/node_modules/@dnd-kit/accessibility/dist/accessibility.esm.js
  var import_react28 = __toESM(require_react());
  var hiddenStyles = {
    display: "none"
  };
  function HiddenText(_ref2) {
    let {
      id,
      value
    } = _ref2;
    return import_react28.default.createElement("div", {
      id,
      style: hiddenStyles
    }, value);
  }
  function LiveRegion(_ref2) {
    let {
      id,
      announcement,
      ariaLiveType = "assertive"
    } = _ref2;
    const visuallyHidden = {
      position: "fixed",
      top: 0,
      left: 0,
      width: 1,
      height: 1,
      margin: -1,
      border: 0,
      padding: 0,
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      clipPath: "inset(100%)",
      whiteSpace: "nowrap"
    };
    return import_react28.default.createElement("div", {
      id,
      style: visuallyHidden,
      role: "status",
      "aria-live": ariaLiveType,
      "aria-atomic": true
    }, announcement);
  }
  function useAnnouncement() {
    const [announcement, setAnnouncement] = (0, import_react28.useState)("");
    const announce = (0, import_react28.useCallback)((value) => {
      if (value != null) {
        setAnnouncement(value);
      }
    }, []);
    return {
      announce,
      announcement
    };
  }

  // ../../node_modules/.pnpm/@dnd-kit+core@6.3.1_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/@dnd-kit/core/dist/core.esm.js
  var DndMonitorContext = /* @__PURE__ */ (0, import_react29.createContext)(null);
  function useDndMonitor(listener) {
    const registerListener = (0, import_react29.useContext)(DndMonitorContext);
    (0, import_react29.useEffect)(() => {
      if (!registerListener) {
        throw new Error("useDndMonitor must be used within a children of <DndContext>");
      }
      const unsubscribe = registerListener(listener);
      return unsubscribe;
    }, [listener, registerListener]);
  }
  function useDndMonitorProvider() {
    const [listeners] = (0, import_react29.useState)(() => /* @__PURE__ */ new Set());
    const registerListener = (0, import_react29.useCallback)((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, [listeners]);
    const dispatch = (0, import_react29.useCallback)((_ref2) => {
      let {
        type,
        event
      } = _ref2;
      listeners.forEach((listener) => {
        var _listener$type;
        return (_listener$type = listener[type]) == null ? void 0 : _listener$type.call(listener, event);
      });
    }, [listeners]);
    return [dispatch, registerListener];
  }
  var defaultScreenReaderInstructions = {
    draggable: "\n    To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.\n  "
  };
  var defaultAnnouncements = {
    onDragStart(_ref2) {
      let {
        active
      } = _ref2;
      return "Picked up draggable item " + active.id + ".";
    },
    onDragOver(_ref2) {
      let {
        active,
        over
      } = _ref2;
      if (over) {
        return "Draggable item " + active.id + " was moved over droppable area " + over.id + ".";
      }
      return "Draggable item " + active.id + " is no longer over a droppable area.";
    },
    onDragEnd(_ref3) {
      let {
        active,
        over
      } = _ref3;
      if (over) {
        return "Draggable item " + active.id + " was dropped over droppable area " + over.id;
      }
      return "Draggable item " + active.id + " was dropped.";
    },
    onDragCancel(_ref4) {
      let {
        active
      } = _ref4;
      return "Dragging was cancelled. Draggable item " + active.id + " was dropped.";
    }
  };
  function Accessibility(_ref2) {
    let {
      announcements = defaultAnnouncements,
      container,
      hiddenTextDescribedById,
      screenReaderInstructions = defaultScreenReaderInstructions
    } = _ref2;
    const {
      announce,
      announcement
    } = useAnnouncement();
    const liveRegionId = useUniqueId("DndLiveRegion");
    const [mounted, setMounted] = (0, import_react29.useState)(false);
    (0, import_react29.useEffect)(() => {
      setMounted(true);
    }, []);
    useDndMonitor((0, import_react29.useMemo)(() => ({
      onDragStart(_ref22) {
        let {
          active
        } = _ref22;
        announce(announcements.onDragStart({
          active
        }));
      },
      onDragMove(_ref3) {
        let {
          active,
          over
        } = _ref3;
        if (announcements.onDragMove) {
          announce(announcements.onDragMove({
            active,
            over
          }));
        }
      },
      onDragOver(_ref4) {
        let {
          active,
          over
        } = _ref4;
        announce(announcements.onDragOver({
          active,
          over
        }));
      },
      onDragEnd(_ref5) {
        let {
          active,
          over
        } = _ref5;
        announce(announcements.onDragEnd({
          active,
          over
        }));
      },
      onDragCancel(_ref6) {
        let {
          active,
          over
        } = _ref6;
        announce(announcements.onDragCancel({
          active,
          over
        }));
      }
    }), [announce, announcements]));
    if (!mounted) {
      return null;
    }
    const markup = import_react29.default.createElement(import_react29.default.Fragment, null, import_react29.default.createElement(HiddenText, {
      id: hiddenTextDescribedById,
      value: screenReaderInstructions.draggable
    }), import_react29.default.createElement(LiveRegion, {
      id: liveRegionId,
      announcement
    }));
    return container ? (0, import_react_dom6.createPortal)(markup, container) : markup;
  }
  var Action;
  (function(Action2) {
    Action2["DragStart"] = "dragStart";
    Action2["DragMove"] = "dragMove";
    Action2["DragEnd"] = "dragEnd";
    Action2["DragCancel"] = "dragCancel";
    Action2["DragOver"] = "dragOver";
    Action2["RegisterDroppable"] = "registerDroppable";
    Action2["SetDroppableDisabled"] = "setDroppableDisabled";
    Action2["UnregisterDroppable"] = "unregisterDroppable";
  })(Action || (Action = {}));
  function noop() {
  }
  function useSensor(sensor, options) {
    return (0, import_react29.useMemo)(
      () => ({
        sensor,
        options: options != null ? options : {}
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [sensor, options]
    );
  }
  function useSensors() {
    for (var _len = arguments.length, sensors = new Array(_len), _key = 0; _key < _len; _key++) {
      sensors[_key] = arguments[_key];
    }
    return (0, import_react29.useMemo)(
      () => [...sensors].filter((sensor) => sensor != null),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [...sensors]
    );
  }
  var defaultCoordinates = /* @__PURE__ */ Object.freeze({
    x: 0,
    y: 0
  });
  function distanceBetween(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  }
  function sortCollisionsAsc(_ref2, _ref22) {
    let {
      data: {
        value: a8
      }
    } = _ref2;
    let {
      data: {
        value: b
      }
    } = _ref22;
    return a8 - b;
  }
  function sortCollisionsDesc(_ref3, _ref4) {
    let {
      data: {
        value: a8
      }
    } = _ref3;
    let {
      data: {
        value: b
      }
    } = _ref4;
    return b - a8;
  }
  function cornersOfRectangle(_ref5) {
    let {
      left,
      top,
      height,
      width
    } = _ref5;
    return [{
      x: left,
      y: top
    }, {
      x: left + width,
      y: top
    }, {
      x: left,
      y: top + height
    }, {
      x: left + width,
      y: top + height
    }];
  }
  function getFirstCollision(collisions, property) {
    if (!collisions || collisions.length === 0) {
      return null;
    }
    const [firstCollision] = collisions;
    return property ? firstCollision[property] : firstCollision;
  }
  function centerOfRectangle(rect, left, top) {
    if (left === void 0) {
      left = rect.left;
    }
    if (top === void 0) {
      top = rect.top;
    }
    return {
      x: left + rect.width * 0.5,
      y: top + rect.height * 0.5
    };
  }
  var closestCenter = (_ref2) => {
    let {
      collisionRect,
      droppableRects,
      droppableContainers
    } = _ref2;
    const centerRect = centerOfRectangle(collisionRect, collisionRect.left, collisionRect.top);
    const collisions = [];
    for (const droppableContainer of droppableContainers) {
      const {
        id
      } = droppableContainer;
      const rect = droppableRects.get(id);
      if (rect) {
        const distBetween = distanceBetween(centerOfRectangle(rect), centerRect);
        collisions.push({
          id,
          data: {
            droppableContainer,
            value: distBetween
          }
        });
      }
    }
    return collisions.sort(sortCollisionsAsc);
  };
  function getIntersectionRatio(entry, target) {
    const top = Math.max(target.top, entry.top);
    const left = Math.max(target.left, entry.left);
    const right = Math.min(target.left + target.width, entry.left + entry.width);
    const bottom = Math.min(target.top + target.height, entry.top + entry.height);
    const width = right - left;
    const height = bottom - top;
    if (left < right && top < bottom) {
      const targetArea = target.width * target.height;
      const entryArea = entry.width * entry.height;
      const intersectionArea = width * height;
      const intersectionRatio = intersectionArea / (targetArea + entryArea - intersectionArea);
      return Number(intersectionRatio.toFixed(4));
    }
    return 0;
  }
  var rectIntersection = (_ref2) => {
    let {
      collisionRect,
      droppableRects,
      droppableContainers
    } = _ref2;
    const collisions = [];
    for (const droppableContainer of droppableContainers) {
      const {
        id
      } = droppableContainer;
      const rect = droppableRects.get(id);
      if (rect) {
        const intersectionRatio = getIntersectionRatio(rect, collisionRect);
        if (intersectionRatio > 0) {
          collisions.push({
            id,
            data: {
              droppableContainer,
              value: intersectionRatio
            }
          });
        }
      }
    }
    return collisions.sort(sortCollisionsDesc);
  };
  function isPointWithinRect(point, rect) {
    const {
      top,
      left,
      bottom,
      right
    } = rect;
    return top <= point.y && point.y <= bottom && left <= point.x && point.x <= right;
  }
  var pointerWithin = (_ref2) => {
    let {
      droppableContainers,
      droppableRects,
      pointerCoordinates
    } = _ref2;
    if (!pointerCoordinates) {
      return [];
    }
    const collisions = [];
    for (const droppableContainer of droppableContainers) {
      const {
        id
      } = droppableContainer;
      const rect = droppableRects.get(id);
      if (rect && isPointWithinRect(pointerCoordinates, rect)) {
        const corners = cornersOfRectangle(rect);
        const distances = corners.reduce((accumulator, corner) => {
          return accumulator + distanceBetween(pointerCoordinates, corner);
        }, 0);
        const effectiveDistance = Number((distances / 4).toFixed(4));
        collisions.push({
          id,
          data: {
            droppableContainer,
            value: effectiveDistance
          }
        });
      }
    }
    return collisions.sort(sortCollisionsAsc);
  };
  function adjustScale(transform, rect1, rect2) {
    return {
      ...transform,
      scaleX: rect1 && rect2 ? rect1.width / rect2.width : 1,
      scaleY: rect1 && rect2 ? rect1.height / rect2.height : 1
    };
  }
  function getRectDelta(rect1, rect2) {
    return rect1 && rect2 ? {
      x: rect1.left - rect2.left,
      y: rect1.top - rect2.top
    } : defaultCoordinates;
  }
  function createRectAdjustmentFn(modifier) {
    return function adjustClientRect(rect) {
      for (var _len = arguments.length, adjustments = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        adjustments[_key - 1] = arguments[_key];
      }
      return adjustments.reduce((acc, adjustment) => ({
        ...acc,
        top: acc.top + modifier * adjustment.y,
        bottom: acc.bottom + modifier * adjustment.y,
        left: acc.left + modifier * adjustment.x,
        right: acc.right + modifier * adjustment.x
      }), {
        ...rect
      });
    };
  }
  var getAdjustedRect = /* @__PURE__ */ createRectAdjustmentFn(1);
  function parseTransform(transform) {
    if (transform.startsWith("matrix3d(")) {
      const transformArray = transform.slice(9, -1).split(/, /);
      return {
        x: +transformArray[12],
        y: +transformArray[13],
        scaleX: +transformArray[0],
        scaleY: +transformArray[5]
      };
    } else if (transform.startsWith("matrix(")) {
      const transformArray = transform.slice(7, -1).split(/, /);
      return {
        x: +transformArray[4],
        y: +transformArray[5],
        scaleX: +transformArray[0],
        scaleY: +transformArray[3]
      };
    }
    return null;
  }
  function inverseTransform(rect, transform, transformOrigin3) {
    const parsedTransform = parseTransform(transform);
    if (!parsedTransform) {
      return rect;
    }
    const {
      scaleX,
      scaleY,
      x: translateX,
      y: translateY
    } = parsedTransform;
    const x = rect.left - translateX - (1 - scaleX) * parseFloat(transformOrigin3);
    const y = rect.top - translateY - (1 - scaleY) * parseFloat(transformOrigin3.slice(transformOrigin3.indexOf(" ") + 1));
    const w = scaleX ? rect.width / scaleX : rect.width;
    const h = scaleY ? rect.height / scaleY : rect.height;
    return {
      width: w,
      height: h,
      top: y,
      right: x + w,
      bottom: y + h,
      left: x
    };
  }
  var defaultOptions = {
    ignoreTransform: false
  };
  function getClientRect(element, options) {
    if (options === void 0) {
      options = defaultOptions;
    }
    let rect = element.getBoundingClientRect();
    if (options.ignoreTransform) {
      const {
        transform,
        transformOrigin: transformOrigin3
      } = getWindow2(element).getComputedStyle(element);
      if (transform) {
        rect = inverseTransform(rect, transform, transformOrigin3);
      }
    }
    const {
      top,
      left,
      width,
      height,
      bottom,
      right
    } = rect;
    return {
      top,
      left,
      width,
      height,
      bottom,
      right
    };
  }
  function getTransformAgnosticClientRect(element) {
    return getClientRect(element, {
      ignoreTransform: true
    });
  }
  function getWindowClientRect(element) {
    const width = element.innerWidth;
    const height = element.innerHeight;
    return {
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height
    };
  }
  function isFixed(node, computedStyle) {
    if (computedStyle === void 0) {
      computedStyle = getWindow2(node).getComputedStyle(node);
    }
    return computedStyle.position === "fixed";
  }
  function isScrollable(element, computedStyle) {
    if (computedStyle === void 0) {
      computedStyle = getWindow2(element).getComputedStyle(element);
    }
    const overflowRegex = /(auto|scroll|overlay)/;
    const properties2 = ["overflow", "overflowX", "overflowY"];
    return properties2.some((property) => {
      const value = computedStyle[property];
      return typeof value === "string" ? overflowRegex.test(value) : false;
    });
  }
  function getScrollableAncestors(element, limit) {
    const scrollParents = [];
    function findScrollableAncestors(node) {
      if (limit != null && scrollParents.length >= limit) {
        return scrollParents;
      }
      if (!node) {
        return scrollParents;
      }
      if (isDocument(node) && node.scrollingElement != null && !scrollParents.includes(node.scrollingElement)) {
        scrollParents.push(node.scrollingElement);
        return scrollParents;
      }
      if (!isHTMLElement2(node) || isSVGElement(node)) {
        return scrollParents;
      }
      if (scrollParents.includes(node)) {
        return scrollParents;
      }
      const computedStyle = getWindow2(element).getComputedStyle(node);
      if (node !== element) {
        if (isScrollable(node, computedStyle)) {
          scrollParents.push(node);
        }
      }
      if (isFixed(node, computedStyle)) {
        return scrollParents;
      }
      return findScrollableAncestors(node.parentNode);
    }
    if (!element) {
      return scrollParents;
    }
    return findScrollableAncestors(element);
  }
  function getFirstScrollableAncestor(node) {
    const [firstScrollableAncestor] = getScrollableAncestors(node, 1);
    return firstScrollableAncestor != null ? firstScrollableAncestor : null;
  }
  function getScrollableElement(element) {
    if (!canUseDOM2 || !element) {
      return null;
    }
    if (isWindow(element)) {
      return element;
    }
    if (!isNode2(element)) {
      return null;
    }
    if (isDocument(element) || element === getOwnerDocument(element).scrollingElement) {
      return window;
    }
    if (isHTMLElement2(element)) {
      return element;
    }
    return null;
  }
  function getScrollXCoordinate(element) {
    if (isWindow(element)) {
      return element.scrollX;
    }
    return element.scrollLeft;
  }
  function getScrollYCoordinate(element) {
    if (isWindow(element)) {
      return element.scrollY;
    }
    return element.scrollTop;
  }
  function getScrollCoordinates(element) {
    return {
      x: getScrollXCoordinate(element),
      y: getScrollYCoordinate(element)
    };
  }
  var Direction;
  (function(Direction2) {
    Direction2[Direction2["Forward"] = 1] = "Forward";
    Direction2[Direction2["Backward"] = -1] = "Backward";
  })(Direction || (Direction = {}));
  function isDocumentScrollingElement(element) {
    if (!canUseDOM2 || !element) {
      return false;
    }
    return element === document.scrollingElement;
  }
  function getScrollPosition(scrollingContainer) {
    const minScroll = {
      x: 0,
      y: 0
    };
    const dimensions = isDocumentScrollingElement(scrollingContainer) ? {
      height: window.innerHeight,
      width: window.innerWidth
    } : {
      height: scrollingContainer.clientHeight,
      width: scrollingContainer.clientWidth
    };
    const maxScroll = {
      x: scrollingContainer.scrollWidth - dimensions.width,
      y: scrollingContainer.scrollHeight - dimensions.height
    };
    const isTop = scrollingContainer.scrollTop <= minScroll.y;
    const isLeft = scrollingContainer.scrollLeft <= minScroll.x;
    const isBottom = scrollingContainer.scrollTop >= maxScroll.y;
    const isRight = scrollingContainer.scrollLeft >= maxScroll.x;
    return {
      isTop,
      isLeft,
      isBottom,
      isRight,
      maxScroll,
      minScroll
    };
  }
  var defaultThreshold = {
    x: 0.2,
    y: 0.2
  };
  function getScrollDirectionAndSpeed(scrollContainer, scrollContainerRect, _ref2, acceleration, thresholdPercentage) {
    let {
      top,
      left,
      right,
      bottom
    } = _ref2;
    if (acceleration === void 0) {
      acceleration = 10;
    }
    if (thresholdPercentage === void 0) {
      thresholdPercentage = defaultThreshold;
    }
    const {
      isTop,
      isBottom,
      isLeft,
      isRight
    } = getScrollPosition(scrollContainer);
    const direction = {
      x: 0,
      y: 0
    };
    const speed = {
      x: 0,
      y: 0
    };
    const threshold = {
      height: scrollContainerRect.height * thresholdPercentage.y,
      width: scrollContainerRect.width * thresholdPercentage.x
    };
    if (!isTop && top <= scrollContainerRect.top + threshold.height) {
      direction.y = Direction.Backward;
      speed.y = acceleration * Math.abs((scrollContainerRect.top + threshold.height - top) / threshold.height);
    } else if (!isBottom && bottom >= scrollContainerRect.bottom - threshold.height) {
      direction.y = Direction.Forward;
      speed.y = acceleration * Math.abs((scrollContainerRect.bottom - threshold.height - bottom) / threshold.height);
    }
    if (!isRight && right >= scrollContainerRect.right - threshold.width) {
      direction.x = Direction.Forward;
      speed.x = acceleration * Math.abs((scrollContainerRect.right - threshold.width - right) / threshold.width);
    } else if (!isLeft && left <= scrollContainerRect.left + threshold.width) {
      direction.x = Direction.Backward;
      speed.x = acceleration * Math.abs((scrollContainerRect.left + threshold.width - left) / threshold.width);
    }
    return {
      direction,
      speed
    };
  }
  function getScrollElementRect(element) {
    if (element === document.scrollingElement) {
      const {
        innerWidth,
        innerHeight
      } = window;
      return {
        top: 0,
        left: 0,
        right: innerWidth,
        bottom: innerHeight,
        width: innerWidth,
        height: innerHeight
      };
    }
    const {
      top,
      left,
      right,
      bottom
    } = element.getBoundingClientRect();
    return {
      top,
      left,
      right,
      bottom,
      width: element.clientWidth,
      height: element.clientHeight
    };
  }
  function getScrollOffsets(scrollableAncestors) {
    return scrollableAncestors.reduce((acc, node) => {
      return add(acc, getScrollCoordinates(node));
    }, defaultCoordinates);
  }
  function getScrollXOffset(scrollableAncestors) {
    return scrollableAncestors.reduce((acc, node) => {
      return acc + getScrollXCoordinate(node);
    }, 0);
  }
  function getScrollYOffset(scrollableAncestors) {
    return scrollableAncestors.reduce((acc, node) => {
      return acc + getScrollYCoordinate(node);
    }, 0);
  }
  function scrollIntoViewIfNeeded(element, measure) {
    if (measure === void 0) {
      measure = getClientRect;
    }
    if (!element) {
      return;
    }
    const {
      top,
      left,
      bottom,
      right
    } = measure(element);
    const firstScrollableAncestor = getFirstScrollableAncestor(element);
    if (!firstScrollableAncestor) {
      return;
    }
    if (bottom <= 0 || right <= 0 || top >= window.innerHeight || left >= window.innerWidth) {
      element.scrollIntoView({
        block: "center",
        inline: "center"
      });
    }
  }
  var properties = [["x", ["left", "right"], getScrollXOffset], ["y", ["top", "bottom"], getScrollYOffset]];
  var Rect = class {
    constructor(rect, element) {
      this.rect = void 0;
      this.width = void 0;
      this.height = void 0;
      this.top = void 0;
      this.bottom = void 0;
      this.right = void 0;
      this.left = void 0;
      const scrollableAncestors = getScrollableAncestors(element);
      const scrollOffsets = getScrollOffsets(scrollableAncestors);
      this.rect = {
        ...rect
      };
      this.width = rect.width;
      this.height = rect.height;
      for (const [axis, keys, getScrollOffset] of properties) {
        for (const key of keys) {
          Object.defineProperty(this, key, {
            get: () => {
              const currentOffsets = getScrollOffset(scrollableAncestors);
              const scrollOffsetsDeltla = scrollOffsets[axis] - currentOffsets;
              return this.rect[key] + scrollOffsetsDeltla;
            },
            enumerable: true
          });
        }
      }
      Object.defineProperty(this, "rect", {
        enumerable: false
      });
    }
  };
  var Listeners = class {
    constructor(target) {
      this.target = void 0;
      this.listeners = [];
      this.removeAll = () => {
        this.listeners.forEach((listener) => {
          var _this$target;
          return (_this$target = this.target) == null ? void 0 : _this$target.removeEventListener(...listener);
        });
      };
      this.target = target;
    }
    add(eventName, handler, options) {
      var _this$target2;
      (_this$target2 = this.target) == null ? void 0 : _this$target2.addEventListener(eventName, handler, options);
      this.listeners.push([eventName, handler, options]);
    }
  };
  function getEventListenerTarget(target) {
    const {
      EventTarget
    } = getWindow2(target);
    return target instanceof EventTarget ? target : getOwnerDocument(target);
  }
  function hasExceededDistance(delta, measurement) {
    const dx = Math.abs(delta.x);
    const dy = Math.abs(delta.y);
    if (typeof measurement === "number") {
      return Math.sqrt(dx ** 2 + dy ** 2) > measurement;
    }
    if ("x" in measurement && "y" in measurement) {
      return dx > measurement.x && dy > measurement.y;
    }
    if ("x" in measurement) {
      return dx > measurement.x;
    }
    if ("y" in measurement) {
      return dy > measurement.y;
    }
    return false;
  }
  var EventName;
  (function(EventName2) {
    EventName2["Click"] = "click";
    EventName2["DragStart"] = "dragstart";
    EventName2["Keydown"] = "keydown";
    EventName2["ContextMenu"] = "contextmenu";
    EventName2["Resize"] = "resize";
    EventName2["SelectionChange"] = "selectionchange";
    EventName2["VisibilityChange"] = "visibilitychange";
  })(EventName || (EventName = {}));
  function preventDefault(event) {
    event.preventDefault();
  }
  function stopPropagation(event) {
    event.stopPropagation();
  }
  var KeyboardCode;
  (function(KeyboardCode2) {
    KeyboardCode2["Space"] = "Space";
    KeyboardCode2["Down"] = "ArrowDown";
    KeyboardCode2["Right"] = "ArrowRight";
    KeyboardCode2["Left"] = "ArrowLeft";
    KeyboardCode2["Up"] = "ArrowUp";
    KeyboardCode2["Esc"] = "Escape";
    KeyboardCode2["Enter"] = "Enter";
    KeyboardCode2["Tab"] = "Tab";
  })(KeyboardCode || (KeyboardCode = {}));
  var defaultKeyboardCodes = {
    start: [KeyboardCode.Space, KeyboardCode.Enter],
    cancel: [KeyboardCode.Esc],
    end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab]
  };
  var defaultKeyboardCoordinateGetter = (event, _ref2) => {
    let {
      currentCoordinates
    } = _ref2;
    switch (event.code) {
      case KeyboardCode.Right:
        return {
          ...currentCoordinates,
          x: currentCoordinates.x + 25
        };
      case KeyboardCode.Left:
        return {
          ...currentCoordinates,
          x: currentCoordinates.x - 25
        };
      case KeyboardCode.Down:
        return {
          ...currentCoordinates,
          y: currentCoordinates.y + 25
        };
      case KeyboardCode.Up:
        return {
          ...currentCoordinates,
          y: currentCoordinates.y - 25
        };
    }
    return void 0;
  };
  var KeyboardSensor = class {
    constructor(props) {
      this.props = void 0;
      this.autoScrollEnabled = false;
      this.referenceCoordinates = void 0;
      this.listeners = void 0;
      this.windowListeners = void 0;
      this.props = props;
      const {
        event: {
          target
        }
      } = props;
      this.props = props;
      this.listeners = new Listeners(getOwnerDocument(target));
      this.windowListeners = new Listeners(getWindow2(target));
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleCancel = this.handleCancel.bind(this);
      this.attach();
    }
    attach() {
      this.handleStart();
      this.windowListeners.add(EventName.Resize, this.handleCancel);
      this.windowListeners.add(EventName.VisibilityChange, this.handleCancel);
      setTimeout(() => this.listeners.add(EventName.Keydown, this.handleKeyDown));
    }
    handleStart() {
      const {
        activeNode,
        onStart
      } = this.props;
      const node = activeNode.node.current;
      if (node) {
        scrollIntoViewIfNeeded(node);
      }
      onStart(defaultCoordinates);
    }
    handleKeyDown(event) {
      if (isKeyboardEvent(event)) {
        const {
          active,
          context,
          options
        } = this.props;
        const {
          keyboardCodes = defaultKeyboardCodes,
          coordinateGetter = defaultKeyboardCoordinateGetter,
          scrollBehavior = "smooth"
        } = options;
        const {
          code
        } = event;
        if (keyboardCodes.end.includes(code)) {
          this.handleEnd(event);
          return;
        }
        if (keyboardCodes.cancel.includes(code)) {
          this.handleCancel(event);
          return;
        }
        const {
          collisionRect
        } = context.current;
        const currentCoordinates = collisionRect ? {
          x: collisionRect.left,
          y: collisionRect.top
        } : defaultCoordinates;
        if (!this.referenceCoordinates) {
          this.referenceCoordinates = currentCoordinates;
        }
        const newCoordinates = coordinateGetter(event, {
          active,
          context: context.current,
          currentCoordinates
        });
        if (newCoordinates) {
          const coordinatesDelta = subtract(newCoordinates, currentCoordinates);
          const scrollDelta = {
            x: 0,
            y: 0
          };
          const {
            scrollableAncestors
          } = context.current;
          for (const scrollContainer of scrollableAncestors) {
            const direction = event.code;
            const {
              isTop,
              isRight,
              isLeft,
              isBottom,
              maxScroll,
              minScroll
            } = getScrollPosition(scrollContainer);
            const scrollElementRect = getScrollElementRect(scrollContainer);
            const clampedCoordinates = {
              x: Math.min(direction === KeyboardCode.Right ? scrollElementRect.right - scrollElementRect.width / 2 : scrollElementRect.right, Math.max(direction === KeyboardCode.Right ? scrollElementRect.left : scrollElementRect.left + scrollElementRect.width / 2, newCoordinates.x)),
              y: Math.min(direction === KeyboardCode.Down ? scrollElementRect.bottom - scrollElementRect.height / 2 : scrollElementRect.bottom, Math.max(direction === KeyboardCode.Down ? scrollElementRect.top : scrollElementRect.top + scrollElementRect.height / 2, newCoordinates.y))
            };
            const canScrollX = direction === KeyboardCode.Right && !isRight || direction === KeyboardCode.Left && !isLeft;
            const canScrollY = direction === KeyboardCode.Down && !isBottom || direction === KeyboardCode.Up && !isTop;
            if (canScrollX && clampedCoordinates.x !== newCoordinates.x) {
              const newScrollCoordinates = scrollContainer.scrollLeft + coordinatesDelta.x;
              const canScrollToNewCoordinates = direction === KeyboardCode.Right && newScrollCoordinates <= maxScroll.x || direction === KeyboardCode.Left && newScrollCoordinates >= minScroll.x;
              if (canScrollToNewCoordinates && !coordinatesDelta.y) {
                scrollContainer.scrollTo({
                  left: newScrollCoordinates,
                  behavior: scrollBehavior
                });
                return;
              }
              if (canScrollToNewCoordinates) {
                scrollDelta.x = scrollContainer.scrollLeft - newScrollCoordinates;
              } else {
                scrollDelta.x = direction === KeyboardCode.Right ? scrollContainer.scrollLeft - maxScroll.x : scrollContainer.scrollLeft - minScroll.x;
              }
              if (scrollDelta.x) {
                scrollContainer.scrollBy({
                  left: -scrollDelta.x,
                  behavior: scrollBehavior
                });
              }
              break;
            } else if (canScrollY && clampedCoordinates.y !== newCoordinates.y) {
              const newScrollCoordinates = scrollContainer.scrollTop + coordinatesDelta.y;
              const canScrollToNewCoordinates = direction === KeyboardCode.Down && newScrollCoordinates <= maxScroll.y || direction === KeyboardCode.Up && newScrollCoordinates >= minScroll.y;
              if (canScrollToNewCoordinates && !coordinatesDelta.x) {
                scrollContainer.scrollTo({
                  top: newScrollCoordinates,
                  behavior: scrollBehavior
                });
                return;
              }
              if (canScrollToNewCoordinates) {
                scrollDelta.y = scrollContainer.scrollTop - newScrollCoordinates;
              } else {
                scrollDelta.y = direction === KeyboardCode.Down ? scrollContainer.scrollTop - maxScroll.y : scrollContainer.scrollTop - minScroll.y;
              }
              if (scrollDelta.y) {
                scrollContainer.scrollBy({
                  top: -scrollDelta.y,
                  behavior: scrollBehavior
                });
              }
              break;
            }
          }
          this.handleMove(event, add(subtract(newCoordinates, this.referenceCoordinates), scrollDelta));
        }
      }
    }
    handleMove(event, coordinates) {
      const {
        onMove
      } = this.props;
      event.preventDefault();
      onMove(coordinates);
    }
    handleEnd(event) {
      const {
        onEnd
      } = this.props;
      event.preventDefault();
      this.detach();
      onEnd();
    }
    handleCancel(event) {
      const {
        onCancel
      } = this.props;
      event.preventDefault();
      this.detach();
      onCancel();
    }
    detach() {
      this.listeners.removeAll();
      this.windowListeners.removeAll();
    }
  };
  KeyboardSensor.activators = [{
    eventName: "onKeyDown",
    handler: (event, _ref2, _ref22) => {
      let {
        keyboardCodes = defaultKeyboardCodes,
        onActivation
      } = _ref2;
      let {
        active
      } = _ref22;
      const {
        code
      } = event.nativeEvent;
      if (keyboardCodes.start.includes(code)) {
        const activator = active.activatorNode.current;
        if (activator && event.target !== activator) {
          return false;
        }
        event.preventDefault();
        onActivation == null ? void 0 : onActivation({
          event: event.nativeEvent
        });
        return true;
      }
      return false;
    }
  }];
  function isDistanceConstraint(constraint) {
    return Boolean(constraint && "distance" in constraint);
  }
  function isDelayConstraint(constraint) {
    return Boolean(constraint && "delay" in constraint);
  }
  var AbstractPointerSensor = class {
    constructor(props, events2, listenerTarget) {
      var _getEventCoordinates;
      if (listenerTarget === void 0) {
        listenerTarget = getEventListenerTarget(props.event.target);
      }
      this.props = void 0;
      this.events = void 0;
      this.autoScrollEnabled = true;
      this.document = void 0;
      this.activated = false;
      this.initialCoordinates = void 0;
      this.timeoutId = null;
      this.listeners = void 0;
      this.documentListeners = void 0;
      this.windowListeners = void 0;
      this.props = props;
      this.events = events2;
      const {
        event
      } = props;
      const {
        target
      } = event;
      this.props = props;
      this.events = events2;
      this.document = getOwnerDocument(target);
      this.documentListeners = new Listeners(this.document);
      this.listeners = new Listeners(listenerTarget);
      this.windowListeners = new Listeners(getWindow2(target));
      this.initialCoordinates = (_getEventCoordinates = getEventCoordinates(event)) != null ? _getEventCoordinates : defaultCoordinates;
      this.handleStart = this.handleStart.bind(this);
      this.handleMove = this.handleMove.bind(this);
      this.handleEnd = this.handleEnd.bind(this);
      this.handleCancel = this.handleCancel.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.removeTextSelection = this.removeTextSelection.bind(this);
      this.attach();
    }
    attach() {
      const {
        events: events2,
        props: {
          options: {
            activationConstraint,
            bypassActivationConstraint
          }
        }
      } = this;
      this.listeners.add(events2.move.name, this.handleMove, {
        passive: false
      });
      this.listeners.add(events2.end.name, this.handleEnd);
      if (events2.cancel) {
        this.listeners.add(events2.cancel.name, this.handleCancel);
      }
      this.windowListeners.add(EventName.Resize, this.handleCancel);
      this.windowListeners.add(EventName.DragStart, preventDefault);
      this.windowListeners.add(EventName.VisibilityChange, this.handleCancel);
      this.windowListeners.add(EventName.ContextMenu, preventDefault);
      this.documentListeners.add(EventName.Keydown, this.handleKeydown);
      if (activationConstraint) {
        if (bypassActivationConstraint != null && bypassActivationConstraint({
          event: this.props.event,
          activeNode: this.props.activeNode,
          options: this.props.options
        })) {
          return this.handleStart();
        }
        if (isDelayConstraint(activationConstraint)) {
          this.timeoutId = setTimeout(this.handleStart, activationConstraint.delay);
          this.handlePending(activationConstraint);
          return;
        }
        if (isDistanceConstraint(activationConstraint)) {
          this.handlePending(activationConstraint);
          return;
        }
      }
      this.handleStart();
    }
    detach() {
      this.listeners.removeAll();
      this.windowListeners.removeAll();
      setTimeout(this.documentListeners.removeAll, 50);
      if (this.timeoutId !== null) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
    }
    handlePending(constraint, offset5) {
      const {
        active,
        onPending
      } = this.props;
      onPending(active, constraint, this.initialCoordinates, offset5);
    }
    handleStart() {
      const {
        initialCoordinates
      } = this;
      const {
        onStart
      } = this.props;
      if (initialCoordinates) {
        this.activated = true;
        this.documentListeners.add(EventName.Click, stopPropagation, {
          capture: true
        });
        this.removeTextSelection();
        this.documentListeners.add(EventName.SelectionChange, this.removeTextSelection);
        onStart(initialCoordinates);
      }
    }
    handleMove(event) {
      var _getEventCoordinates2;
      const {
        activated,
        initialCoordinates,
        props
      } = this;
      const {
        onMove,
        options: {
          activationConstraint
        }
      } = props;
      if (!initialCoordinates) {
        return;
      }
      const coordinates = (_getEventCoordinates2 = getEventCoordinates(event)) != null ? _getEventCoordinates2 : defaultCoordinates;
      const delta = subtract(initialCoordinates, coordinates);
      if (!activated && activationConstraint) {
        if (isDistanceConstraint(activationConstraint)) {
          if (activationConstraint.tolerance != null && hasExceededDistance(delta, activationConstraint.tolerance)) {
            return this.handleCancel();
          }
          if (hasExceededDistance(delta, activationConstraint.distance)) {
            return this.handleStart();
          }
        }
        if (isDelayConstraint(activationConstraint)) {
          if (hasExceededDistance(delta, activationConstraint.tolerance)) {
            return this.handleCancel();
          }
        }
        this.handlePending(activationConstraint, delta);
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      onMove(coordinates);
    }
    handleEnd() {
      const {
        onAbort,
        onEnd
      } = this.props;
      this.detach();
      if (!this.activated) {
        onAbort(this.props.active);
      }
      onEnd();
    }
    handleCancel() {
      const {
        onAbort,
        onCancel
      } = this.props;
      this.detach();
      if (!this.activated) {
        onAbort(this.props.active);
      }
      onCancel();
    }
    handleKeydown(event) {
      if (event.code === KeyboardCode.Esc) {
        this.handleCancel();
      }
    }
    removeTextSelection() {
      var _this$document$getSel;
      (_this$document$getSel = this.document.getSelection()) == null ? void 0 : _this$document$getSel.removeAllRanges();
    }
  };
  var events = {
    cancel: {
      name: "pointercancel"
    },
    move: {
      name: "pointermove"
    },
    end: {
      name: "pointerup"
    }
  };
  var PointerSensor = class extends AbstractPointerSensor {
    constructor(props) {
      const {
        event
      } = props;
      const listenerTarget = getOwnerDocument(event.target);
      super(props, events, listenerTarget);
    }
  };
  PointerSensor.activators = [{
    eventName: "onPointerDown",
    handler: (_ref2, _ref22) => {
      let {
        nativeEvent: event
      } = _ref2;
      let {
        onActivation
      } = _ref22;
      if (!event.isPrimary || event.button !== 0) {
        return false;
      }
      onActivation == null ? void 0 : onActivation({
        event
      });
      return true;
    }
  }];
  var events$1 = {
    move: {
      name: "mousemove"
    },
    end: {
      name: "mouseup"
    }
  };
  var MouseButton;
  (function(MouseButton2) {
    MouseButton2[MouseButton2["RightClick"] = 2] = "RightClick";
  })(MouseButton || (MouseButton = {}));
  var MouseSensor = class extends AbstractPointerSensor {
    constructor(props) {
      super(props, events$1, getOwnerDocument(props.event.target));
    }
  };
  MouseSensor.activators = [{
    eventName: "onMouseDown",
    handler: (_ref2, _ref22) => {
      let {
        nativeEvent: event
      } = _ref2;
      let {
        onActivation
      } = _ref22;
      if (event.button === MouseButton.RightClick) {
        return false;
      }
      onActivation == null ? void 0 : onActivation({
        event
      });
      return true;
    }
  }];
  var events$2 = {
    cancel: {
      name: "touchcancel"
    },
    move: {
      name: "touchmove"
    },
    end: {
      name: "touchend"
    }
  };
  var TouchSensor = class extends AbstractPointerSensor {
    constructor(props) {
      super(props, events$2);
    }
    static setup() {
      window.addEventListener(events$2.move.name, noop2, {
        capture: false,
        passive: false
      });
      return function teardown() {
        window.removeEventListener(events$2.move.name, noop2);
      };
      function noop2() {
      }
    }
  };
  TouchSensor.activators = [{
    eventName: "onTouchStart",
    handler: (_ref2, _ref22) => {
      let {
        nativeEvent: event
      } = _ref2;
      let {
        onActivation
      } = _ref22;
      const {
        touches
      } = event;
      if (touches.length > 1) {
        return false;
      }
      onActivation == null ? void 0 : onActivation({
        event
      });
      return true;
    }
  }];
  var AutoScrollActivator;
  (function(AutoScrollActivator2) {
    AutoScrollActivator2[AutoScrollActivator2["Pointer"] = 0] = "Pointer";
    AutoScrollActivator2[AutoScrollActivator2["DraggableRect"] = 1] = "DraggableRect";
  })(AutoScrollActivator || (AutoScrollActivator = {}));
  var TraversalOrder;
  (function(TraversalOrder2) {
    TraversalOrder2[TraversalOrder2["TreeOrder"] = 0] = "TreeOrder";
    TraversalOrder2[TraversalOrder2["ReversedTreeOrder"] = 1] = "ReversedTreeOrder";
  })(TraversalOrder || (TraversalOrder = {}));
  function useAutoScroller(_ref2) {
    let {
      acceleration,
      activator = AutoScrollActivator.Pointer,
      canScroll,
      draggingRect,
      enabled,
      interval = 5,
      order = TraversalOrder.TreeOrder,
      pointerCoordinates,
      scrollableAncestors,
      scrollableAncestorRects,
      delta,
      threshold
    } = _ref2;
    const scrollIntent = useScrollIntent({
      delta,
      disabled: !enabled
    });
    const [setAutoScrollInterval, clearAutoScrollInterval] = useInterval();
    const scrollSpeed = (0, import_react29.useRef)({
      x: 0,
      y: 0
    });
    const scrollDirection = (0, import_react29.useRef)({
      x: 0,
      y: 0
    });
    const rect = (0, import_react29.useMemo)(() => {
      switch (activator) {
        case AutoScrollActivator.Pointer:
          return pointerCoordinates ? {
            top: pointerCoordinates.y,
            bottom: pointerCoordinates.y,
            left: pointerCoordinates.x,
            right: pointerCoordinates.x
          } : null;
        case AutoScrollActivator.DraggableRect:
          return draggingRect;
      }
    }, [activator, draggingRect, pointerCoordinates]);
    const scrollContainerRef = (0, import_react29.useRef)(null);
    const autoScroll = (0, import_react29.useCallback)(() => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      const scrollLeft = scrollSpeed.current.x * scrollDirection.current.x;
      const scrollTop = scrollSpeed.current.y * scrollDirection.current.y;
      scrollContainer.scrollBy(scrollLeft, scrollTop);
    }, []);
    const sortedScrollableAncestors = (0, import_react29.useMemo)(() => order === TraversalOrder.TreeOrder ? [...scrollableAncestors].reverse() : scrollableAncestors, [order, scrollableAncestors]);
    (0, import_react29.useEffect)(
      () => {
        if (!enabled || !scrollableAncestors.length || !rect) {
          clearAutoScrollInterval();
          return;
        }
        for (const scrollContainer of sortedScrollableAncestors) {
          if ((canScroll == null ? void 0 : canScroll(scrollContainer)) === false) {
            continue;
          }
          const index3 = scrollableAncestors.indexOf(scrollContainer);
          const scrollContainerRect = scrollableAncestorRects[index3];
          if (!scrollContainerRect) {
            continue;
          }
          const {
            direction,
            speed
          } = getScrollDirectionAndSpeed(scrollContainer, scrollContainerRect, rect, acceleration, threshold);
          for (const axis of ["x", "y"]) {
            if (!scrollIntent[axis][direction[axis]]) {
              speed[axis] = 0;
              direction[axis] = 0;
            }
          }
          if (speed.x > 0 || speed.y > 0) {
            clearAutoScrollInterval();
            scrollContainerRef.current = scrollContainer;
            setAutoScrollInterval(autoScroll, interval);
            scrollSpeed.current = speed;
            scrollDirection.current = direction;
            return;
          }
        }
        scrollSpeed.current = {
          x: 0,
          y: 0
        };
        scrollDirection.current = {
          x: 0,
          y: 0
        };
        clearAutoScrollInterval();
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        acceleration,
        autoScroll,
        canScroll,
        clearAutoScrollInterval,
        enabled,
        interval,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        JSON.stringify(rect),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        JSON.stringify(scrollIntent),
        setAutoScrollInterval,
        scrollableAncestors,
        sortedScrollableAncestors,
        scrollableAncestorRects,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        JSON.stringify(threshold)
      ]
    );
  }
  var defaultScrollIntent = {
    x: {
      [Direction.Backward]: false,
      [Direction.Forward]: false
    },
    y: {
      [Direction.Backward]: false,
      [Direction.Forward]: false
    }
  };
  function useScrollIntent(_ref2) {
    let {
      delta,
      disabled
    } = _ref2;
    const previousDelta = usePrevious(delta);
    return useLazyMemo((previousIntent) => {
      if (disabled || !previousDelta || !previousIntent) {
        return defaultScrollIntent;
      }
      const direction = {
        x: Math.sign(delta.x - previousDelta.x),
        y: Math.sign(delta.y - previousDelta.y)
      };
      return {
        x: {
          [Direction.Backward]: previousIntent.x[Direction.Backward] || direction.x === -1,
          [Direction.Forward]: previousIntent.x[Direction.Forward] || direction.x === 1
        },
        y: {
          [Direction.Backward]: previousIntent.y[Direction.Backward] || direction.y === -1,
          [Direction.Forward]: previousIntent.y[Direction.Forward] || direction.y === 1
        }
      };
    }, [disabled, delta, previousDelta]);
  }
  function useCachedNode(draggableNodes, id) {
    const draggableNode = id != null ? draggableNodes.get(id) : void 0;
    const node = draggableNode ? draggableNode.node.current : null;
    return useLazyMemo((cachedNode) => {
      var _ref2;
      if (id == null) {
        return null;
      }
      return (_ref2 = node != null ? node : cachedNode) != null ? _ref2 : null;
    }, [node, id]);
  }
  function useCombineActivators(sensors, getSyntheticHandler) {
    return (0, import_react29.useMemo)(() => sensors.reduce((accumulator, sensor) => {
      const {
        sensor: Sensor
      } = sensor;
      const sensorActivators = Sensor.activators.map((activator) => ({
        eventName: activator.eventName,
        handler: getSyntheticHandler(activator.handler, sensor)
      }));
      return [...accumulator, ...sensorActivators];
    }, []), [sensors, getSyntheticHandler]);
  }
  var MeasuringStrategy;
  (function(MeasuringStrategy2) {
    MeasuringStrategy2[MeasuringStrategy2["Always"] = 0] = "Always";
    MeasuringStrategy2[MeasuringStrategy2["BeforeDragging"] = 1] = "BeforeDragging";
    MeasuringStrategy2[MeasuringStrategy2["WhileDragging"] = 2] = "WhileDragging";
  })(MeasuringStrategy || (MeasuringStrategy = {}));
  var MeasuringFrequency;
  (function(MeasuringFrequency2) {
    MeasuringFrequency2["Optimized"] = "optimized";
  })(MeasuringFrequency || (MeasuringFrequency = {}));
  var defaultValue = /* @__PURE__ */ new Map();
  function useDroppableMeasuring(containers, _ref2) {
    let {
      dragging,
      dependencies,
      config
    } = _ref2;
    const [queue, setQueue] = (0, import_react29.useState)(null);
    const {
      frequency,
      measure,
      strategy
    } = config;
    const containersRef = (0, import_react29.useRef)(containers);
    const disabled = isDisabled();
    const disabledRef = useLatestValue(disabled);
    const measureDroppableContainers = (0, import_react29.useCallback)(function(ids2) {
      if (ids2 === void 0) {
        ids2 = [];
      }
      if (disabledRef.current) {
        return;
      }
      setQueue((value) => {
        if (value === null) {
          return ids2;
        }
        return value.concat(ids2.filter((id) => !value.includes(id)));
      });
    }, [disabledRef]);
    const timeoutId = (0, import_react29.useRef)(null);
    const droppableRects = useLazyMemo((previousValue) => {
      if (disabled && !dragging) {
        return defaultValue;
      }
      if (!previousValue || previousValue === defaultValue || containersRef.current !== containers || queue != null) {
        const map = /* @__PURE__ */ new Map();
        for (let container of containers) {
          if (!container) {
            continue;
          }
          if (queue && queue.length > 0 && !queue.includes(container.id) && container.rect.current) {
            map.set(container.id, container.rect.current);
            continue;
          }
          const node = container.node.current;
          const rect = node ? new Rect(measure(node), node) : null;
          container.rect.current = rect;
          if (rect) {
            map.set(container.id, rect);
          }
        }
        return map;
      }
      return previousValue;
    }, [containers, queue, dragging, disabled, measure]);
    (0, import_react29.useEffect)(() => {
      containersRef.current = containers;
    }, [containers]);
    (0, import_react29.useEffect)(
      () => {
        if (disabled) {
          return;
        }
        measureDroppableContainers();
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [dragging, disabled]
    );
    (0, import_react29.useEffect)(
      () => {
        if (queue && queue.length > 0) {
          setQueue(null);
        }
      },
      //eslint-disable-next-line react-hooks/exhaustive-deps
      [JSON.stringify(queue)]
    );
    (0, import_react29.useEffect)(
      () => {
        if (disabled || typeof frequency !== "number" || timeoutId.current !== null) {
          return;
        }
        timeoutId.current = setTimeout(() => {
          measureDroppableContainers();
          timeoutId.current = null;
        }, frequency);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [frequency, disabled, measureDroppableContainers, ...dependencies]
    );
    return {
      droppableRects,
      measureDroppableContainers,
      measuringScheduled: queue != null
    };
    function isDisabled() {
      switch (strategy) {
        case MeasuringStrategy.Always:
          return false;
        case MeasuringStrategy.BeforeDragging:
          return dragging;
        default:
          return !dragging;
      }
    }
  }
  function useInitialValue(value, computeFn) {
    return useLazyMemo((previousValue) => {
      if (!value) {
        return null;
      }
      if (previousValue) {
        return previousValue;
      }
      return typeof computeFn === "function" ? computeFn(value) : value;
    }, [computeFn, value]);
  }
  function useInitialRect(node, measure) {
    return useInitialValue(node, measure);
  }
  function useMutationObserver(_ref2) {
    let {
      callback,
      disabled
    } = _ref2;
    const handleMutations = useEvent(callback);
    const mutationObserver = (0, import_react29.useMemo)(() => {
      if (disabled || typeof window === "undefined" || typeof window.MutationObserver === "undefined") {
        return void 0;
      }
      const {
        MutationObserver: MutationObserver2
      } = window;
      return new MutationObserver2(handleMutations);
    }, [handleMutations, disabled]);
    (0, import_react29.useEffect)(() => {
      return () => mutationObserver == null ? void 0 : mutationObserver.disconnect();
    }, [mutationObserver]);
    return mutationObserver;
  }
  function useResizeObserver(_ref2) {
    let {
      callback,
      disabled
    } = _ref2;
    const handleResize = useEvent(callback);
    const resizeObserver = (0, import_react29.useMemo)(
      () => {
        if (disabled || typeof window === "undefined" || typeof window.ResizeObserver === "undefined") {
          return void 0;
        }
        const {
          ResizeObserver: ResizeObserver2
        } = window;
        return new ResizeObserver2(handleResize);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [disabled]
    );
    (0, import_react29.useEffect)(() => {
      return () => resizeObserver == null ? void 0 : resizeObserver.disconnect();
    }, [resizeObserver]);
    return resizeObserver;
  }
  function defaultMeasure(element) {
    return new Rect(getClientRect(element), element);
  }
  function useRect(element, measure, fallbackRect) {
    if (measure === void 0) {
      measure = defaultMeasure;
    }
    const [rect, setRect] = (0, import_react29.useState)(null);
    function measureRect() {
      setRect((currentRect) => {
        if (!element) {
          return null;
        }
        if (element.isConnected === false) {
          var _ref2;
          return (_ref2 = currentRect != null ? currentRect : fallbackRect) != null ? _ref2 : null;
        }
        const newRect = measure(element);
        if (JSON.stringify(currentRect) === JSON.stringify(newRect)) {
          return currentRect;
        }
        return newRect;
      });
    }
    const mutationObserver = useMutationObserver({
      callback(records) {
        if (!element) {
          return;
        }
        for (const record of records) {
          const {
            type,
            target
          } = record;
          if (type === "childList" && target instanceof HTMLElement && target.contains(element)) {
            measureRect();
            break;
          }
        }
      }
    });
    const resizeObserver = useResizeObserver({
      callback: measureRect
    });
    useIsomorphicLayoutEffect2(() => {
      measureRect();
      if (element) {
        resizeObserver == null ? void 0 : resizeObserver.observe(element);
        mutationObserver == null ? void 0 : mutationObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      } else {
        resizeObserver == null ? void 0 : resizeObserver.disconnect();
        mutationObserver == null ? void 0 : mutationObserver.disconnect();
      }
    }, [element]);
    return rect;
  }
  function useRectDelta(rect) {
    const initialRect = useInitialValue(rect);
    return getRectDelta(rect, initialRect);
  }
  var defaultValue$1 = [];
  function useScrollableAncestors(node) {
    const previousNode = (0, import_react29.useRef)(node);
    const ancestors = useLazyMemo((previousValue) => {
      if (!node) {
        return defaultValue$1;
      }
      if (previousValue && previousValue !== defaultValue$1 && node && previousNode.current && node.parentNode === previousNode.current.parentNode) {
        return previousValue;
      }
      return getScrollableAncestors(node);
    }, [node]);
    (0, import_react29.useEffect)(() => {
      previousNode.current = node;
    }, [node]);
    return ancestors;
  }
  function useScrollOffsets(elements) {
    const [scrollCoordinates, setScrollCoordinates] = (0, import_react29.useState)(null);
    const prevElements = (0, import_react29.useRef)(elements);
    const handleScroll2 = (0, import_react29.useCallback)((event) => {
      const scrollingElement = getScrollableElement(event.target);
      if (!scrollingElement) {
        return;
      }
      setScrollCoordinates((scrollCoordinates2) => {
        if (!scrollCoordinates2) {
          return null;
        }
        scrollCoordinates2.set(scrollingElement, getScrollCoordinates(scrollingElement));
        return new Map(scrollCoordinates2);
      });
    }, []);
    (0, import_react29.useEffect)(() => {
      const previousElements = prevElements.current;
      if (elements !== previousElements) {
        cleanup(previousElements);
        const entries = elements.map((element) => {
          const scrollableElement = getScrollableElement(element);
          if (scrollableElement) {
            scrollableElement.addEventListener("scroll", handleScroll2, {
              passive: true
            });
            return [scrollableElement, getScrollCoordinates(scrollableElement)];
          }
          return null;
        }).filter((entry) => entry != null);
        setScrollCoordinates(entries.length ? new Map(entries) : null);
        prevElements.current = elements;
      }
      return () => {
        cleanup(elements);
        cleanup(previousElements);
      };
      function cleanup(elements2) {
        elements2.forEach((element) => {
          const scrollableElement = getScrollableElement(element);
          scrollableElement == null ? void 0 : scrollableElement.removeEventListener("scroll", handleScroll2);
        });
      }
    }, [handleScroll2, elements]);
    return (0, import_react29.useMemo)(() => {
      if (elements.length) {
        return scrollCoordinates ? Array.from(scrollCoordinates.values()).reduce((acc, coordinates) => add(acc, coordinates), defaultCoordinates) : getScrollOffsets(elements);
      }
      return defaultCoordinates;
    }, [elements, scrollCoordinates]);
  }
  function useScrollOffsetsDelta(scrollOffsets, dependencies) {
    if (dependencies === void 0) {
      dependencies = [];
    }
    const initialScrollOffsets = (0, import_react29.useRef)(null);
    (0, import_react29.useEffect)(
      () => {
        initialScrollOffsets.current = null;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      dependencies
    );
    (0, import_react29.useEffect)(() => {
      const hasScrollOffsets = scrollOffsets !== defaultCoordinates;
      if (hasScrollOffsets && !initialScrollOffsets.current) {
        initialScrollOffsets.current = scrollOffsets;
      }
      if (!hasScrollOffsets && initialScrollOffsets.current) {
        initialScrollOffsets.current = null;
      }
    }, [scrollOffsets]);
    return initialScrollOffsets.current ? subtract(scrollOffsets, initialScrollOffsets.current) : defaultCoordinates;
  }
  function useSensorSetup(sensors) {
    (0, import_react29.useEffect)(
      () => {
        if (!canUseDOM2) {
          return;
        }
        const teardownFns = sensors.map((_ref2) => {
          let {
            sensor
          } = _ref2;
          return sensor.setup == null ? void 0 : sensor.setup();
        });
        return () => {
          for (const teardown of teardownFns) {
            teardown == null ? void 0 : teardown();
          }
        };
      },
      // TO-DO: Sensors length could theoretically change which would not be a valid dependency
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sensors.map((_ref2) => {
        let {
          sensor
        } = _ref2;
        return sensor;
      })
    );
  }
  function useSyntheticListeners(listeners, id) {
    return (0, import_react29.useMemo)(() => {
      return listeners.reduce((acc, _ref2) => {
        let {
          eventName,
          handler
        } = _ref2;
        acc[eventName] = (event) => {
          handler(event, id);
        };
        return acc;
      }, {});
    }, [listeners, id]);
  }
  function useWindowRect(element) {
    return (0, import_react29.useMemo)(() => element ? getWindowClientRect(element) : null, [element]);
  }
  var defaultValue$2 = [];
  function useRects(elements, measure) {
    if (measure === void 0) {
      measure = getClientRect;
    }
    const [firstElement] = elements;
    const windowRect = useWindowRect(firstElement ? getWindow2(firstElement) : null);
    const [rects, setRects] = (0, import_react29.useState)(defaultValue$2);
    function measureRects() {
      setRects(() => {
        if (!elements.length) {
          return defaultValue$2;
        }
        return elements.map((element) => isDocumentScrollingElement(element) ? windowRect : new Rect(measure(element), element));
      });
    }
    const resizeObserver = useResizeObserver({
      callback: measureRects
    });
    useIsomorphicLayoutEffect2(() => {
      resizeObserver == null ? void 0 : resizeObserver.disconnect();
      measureRects();
      elements.forEach((element) => resizeObserver == null ? void 0 : resizeObserver.observe(element));
    }, [elements]);
    return rects;
  }
  function getMeasurableNode(node) {
    if (!node) {
      return null;
    }
    if (node.children.length > 1) {
      return node;
    }
    const firstChild = node.children[0];
    return isHTMLElement2(firstChild) ? firstChild : node;
  }
  function useDragOverlayMeasuring(_ref2) {
    let {
      measure
    } = _ref2;
    const [rect, setRect] = (0, import_react29.useState)(null);
    const handleResize = (0, import_react29.useCallback)((entries) => {
      for (const {
        target
      } of entries) {
        if (isHTMLElement2(target)) {
          setRect((rect2) => {
            const newRect = measure(target);
            return rect2 ? {
              ...rect2,
              width: newRect.width,
              height: newRect.height
            } : newRect;
          });
          break;
        }
      }
    }, [measure]);
    const resizeObserver = useResizeObserver({
      callback: handleResize
    });
    const handleNodeChange = (0, import_react29.useCallback)((element) => {
      const node = getMeasurableNode(element);
      resizeObserver == null ? void 0 : resizeObserver.disconnect();
      if (node) {
        resizeObserver == null ? void 0 : resizeObserver.observe(node);
      }
      setRect(node ? measure(node) : null);
    }, [measure, resizeObserver]);
    const [nodeRef, setRef3] = useNodeRef(handleNodeChange);
    return (0, import_react29.useMemo)(() => ({
      nodeRef,
      rect,
      setRef: setRef3
    }), [rect, nodeRef, setRef3]);
  }
  var defaultSensors = [{
    sensor: PointerSensor,
    options: {}
  }, {
    sensor: KeyboardSensor,
    options: {}
  }];
  var defaultData = {
    current: {}
  };
  var defaultMeasuringConfiguration = {
    draggable: {
      measure: getTransformAgnosticClientRect
    },
    droppable: {
      measure: getTransformAgnosticClientRect,
      strategy: MeasuringStrategy.WhileDragging,
      frequency: MeasuringFrequency.Optimized
    },
    dragOverlay: {
      measure: getClientRect
    }
  };
  var DroppableContainersMap = class extends Map {
    get(id) {
      var _super$get;
      return id != null ? (_super$get = super.get(id)) != null ? _super$get : void 0 : void 0;
    }
    toArray() {
      return Array.from(this.values());
    }
    getEnabled() {
      return this.toArray().filter((_ref2) => {
        let {
          disabled
        } = _ref2;
        return !disabled;
      });
    }
    getNodeFor(id) {
      var _this$get$node$curren, _this$get;
      return (_this$get$node$curren = (_this$get = this.get(id)) == null ? void 0 : _this$get.node.current) != null ? _this$get$node$curren : void 0;
    }
  };
  var defaultPublicContext = {
    activatorEvent: null,
    active: null,
    activeNode: null,
    activeNodeRect: null,
    collisions: null,
    containerNodeRect: null,
    draggableNodes: /* @__PURE__ */ new Map(),
    droppableRects: /* @__PURE__ */ new Map(),
    droppableContainers: /* @__PURE__ */ new DroppableContainersMap(),
    over: null,
    dragOverlay: {
      nodeRef: {
        current: null
      },
      rect: null,
      setRef: noop
    },
    scrollableAncestors: [],
    scrollableAncestorRects: [],
    measuringConfiguration: defaultMeasuringConfiguration,
    measureDroppableContainers: noop,
    windowRect: null,
    measuringScheduled: false
  };
  var defaultInternalContext = {
    activatorEvent: null,
    activators: [],
    active: null,
    activeNodeRect: null,
    ariaDescribedById: {
      draggable: ""
    },
    dispatch: noop,
    draggableNodes: /* @__PURE__ */ new Map(),
    over: null,
    measureDroppableContainers: noop
  };
  var InternalContext = /* @__PURE__ */ (0, import_react29.createContext)(defaultInternalContext);
  var PublicContext = /* @__PURE__ */ (0, import_react29.createContext)(defaultPublicContext);
  function getInitialState() {
    return {
      draggable: {
        active: null,
        initialCoordinates: {
          x: 0,
          y: 0
        },
        nodes: /* @__PURE__ */ new Map(),
        translate: {
          x: 0,
          y: 0
        }
      },
      droppable: {
        containers: new DroppableContainersMap()
      }
    };
  }
  function reducer(state, action) {
    switch (action.type) {
      case Action.DragStart:
        return {
          ...state,
          draggable: {
            ...state.draggable,
            initialCoordinates: action.initialCoordinates,
            active: action.active
          }
        };
      case Action.DragMove:
        if (state.draggable.active == null) {
          return state;
        }
        return {
          ...state,
          draggable: {
            ...state.draggable,
            translate: {
              x: action.coordinates.x - state.draggable.initialCoordinates.x,
              y: action.coordinates.y - state.draggable.initialCoordinates.y
            }
          }
        };
      case Action.DragEnd:
      case Action.DragCancel:
        return {
          ...state,
          draggable: {
            ...state.draggable,
            active: null,
            initialCoordinates: {
              x: 0,
              y: 0
            },
            translate: {
              x: 0,
              y: 0
            }
          }
        };
      case Action.RegisterDroppable: {
        const {
          element
        } = action;
        const {
          id
        } = element;
        const containers = new DroppableContainersMap(state.droppable.containers);
        containers.set(id, element);
        return {
          ...state,
          droppable: {
            ...state.droppable,
            containers
          }
        };
      }
      case Action.SetDroppableDisabled: {
        const {
          id,
          key,
          disabled
        } = action;
        const element = state.droppable.containers.get(id);
        if (!element || key !== element.key) {
          return state;
        }
        const containers = new DroppableContainersMap(state.droppable.containers);
        containers.set(id, {
          ...element,
          disabled
        });
        return {
          ...state,
          droppable: {
            ...state.droppable,
            containers
          }
        };
      }
      case Action.UnregisterDroppable: {
        const {
          id,
          key
        } = action;
        const element = state.droppable.containers.get(id);
        if (!element || key !== element.key) {
          return state;
        }
        const containers = new DroppableContainersMap(state.droppable.containers);
        containers.delete(id);
        return {
          ...state,
          droppable: {
            ...state.droppable,
            containers
          }
        };
      }
      default: {
        return state;
      }
    }
  }
  function RestoreFocus(_ref2) {
    let {
      disabled
    } = _ref2;
    const {
      active,
      activatorEvent,
      draggableNodes
    } = (0, import_react29.useContext)(InternalContext);
    const previousActivatorEvent = usePrevious(activatorEvent);
    const previousActiveId = usePrevious(active == null ? void 0 : active.id);
    (0, import_react29.useEffect)(() => {
      if (disabled) {
        return;
      }
      if (!activatorEvent && previousActivatorEvent && previousActiveId != null) {
        if (!isKeyboardEvent(previousActivatorEvent)) {
          return;
        }
        if (document.activeElement === previousActivatorEvent.target) {
          return;
        }
        const draggableNode = draggableNodes.get(previousActiveId);
        if (!draggableNode) {
          return;
        }
        const {
          activatorNode,
          node
        } = draggableNode;
        if (!activatorNode.current && !node.current) {
          return;
        }
        requestAnimationFrame(() => {
          for (const element of [activatorNode.current, node.current]) {
            if (!element) {
              continue;
            }
            const focusableNode = findFirstFocusableNode(element);
            if (focusableNode) {
              focusableNode.focus();
              break;
            }
          }
        });
      }
    }, [activatorEvent, disabled, draggableNodes, previousActiveId, previousActivatorEvent]);
    return null;
  }
  function applyModifiers(modifiers, _ref2) {
    let {
      transform,
      ...args
    } = _ref2;
    return modifiers != null && modifiers.length ? modifiers.reduce((accumulator, modifier) => {
      return modifier({
        transform: accumulator,
        ...args
      });
    }, transform) : transform;
  }
  function useMeasuringConfiguration(config) {
    return (0, import_react29.useMemo)(
      () => ({
        draggable: {
          ...defaultMeasuringConfiguration.draggable,
          ...config == null ? void 0 : config.draggable
        },
        droppable: {
          ...defaultMeasuringConfiguration.droppable,
          ...config == null ? void 0 : config.droppable
        },
        dragOverlay: {
          ...defaultMeasuringConfiguration.dragOverlay,
          ...config == null ? void 0 : config.dragOverlay
        }
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [config == null ? void 0 : config.draggable, config == null ? void 0 : config.droppable, config == null ? void 0 : config.dragOverlay]
    );
  }
  function useLayoutShiftScrollCompensation(_ref2) {
    let {
      activeNode,
      measure,
      initialRect,
      config = true
    } = _ref2;
    const initialized = (0, import_react29.useRef)(false);
    const {
      x,
      y
    } = typeof config === "boolean" ? {
      x: config,
      y: config
    } : config;
    useIsomorphicLayoutEffect2(() => {
      const disabled = !x && !y;
      if (disabled || !activeNode) {
        initialized.current = false;
        return;
      }
      if (initialized.current || !initialRect) {
        return;
      }
      const node = activeNode == null ? void 0 : activeNode.node.current;
      if (!node || node.isConnected === false) {
        return;
      }
      const rect = measure(node);
      const rectDelta = getRectDelta(rect, initialRect);
      if (!x) {
        rectDelta.x = 0;
      }
      if (!y) {
        rectDelta.y = 0;
      }
      initialized.current = true;
      if (Math.abs(rectDelta.x) > 0 || Math.abs(rectDelta.y) > 0) {
        const firstScrollableAncestor = getFirstScrollableAncestor(node);
        if (firstScrollableAncestor) {
          firstScrollableAncestor.scrollBy({
            top: rectDelta.y,
            left: rectDelta.x
          });
        }
      }
    }, [activeNode, x, y, initialRect, measure]);
  }
  var ActiveDraggableContext = /* @__PURE__ */ (0, import_react29.createContext)({
    ...defaultCoordinates,
    scaleX: 1,
    scaleY: 1
  });
  var Status;
  (function(Status2) {
    Status2[Status2["Uninitialized"] = 0] = "Uninitialized";
    Status2[Status2["Initializing"] = 1] = "Initializing";
    Status2[Status2["Initialized"] = 2] = "Initialized";
  })(Status || (Status = {}));
  var DndContext = /* @__PURE__ */ (0, import_react29.memo)(function DndContext2(_ref2) {
    var _sensorContext$curren, _dragOverlay$nodeRef$, _dragOverlay$rect, _over$rect;
    let {
      id,
      accessibility,
      autoScroll = true,
      children,
      sensors = defaultSensors,
      collisionDetection = rectIntersection,
      measuring,
      modifiers,
      ...props
    } = _ref2;
    const store = (0, import_react29.useReducer)(reducer, void 0, getInitialState);
    const [state, dispatch] = store;
    const [dispatchMonitorEvent, registerMonitorListener] = useDndMonitorProvider();
    const [status, setStatus] = (0, import_react29.useState)(Status.Uninitialized);
    const isInitialized = status === Status.Initialized;
    const {
      draggable: {
        active: activeId,
        nodes: draggableNodes,
        translate
      },
      droppable: {
        containers: droppableContainers
      }
    } = state;
    const node = activeId != null ? draggableNodes.get(activeId) : null;
    const activeRects = (0, import_react29.useRef)({
      initial: null,
      translated: null
    });
    const active = (0, import_react29.useMemo)(() => {
      var _node$data;
      return activeId != null ? {
        id: activeId,
        // It's possible for the active node to unmount while dragging
        data: (_node$data = node == null ? void 0 : node.data) != null ? _node$data : defaultData,
        rect: activeRects
      } : null;
    }, [activeId, node]);
    const activeRef = (0, import_react29.useRef)(null);
    const [activeSensor, setActiveSensor] = (0, import_react29.useState)(null);
    const [activatorEvent, setActivatorEvent] = (0, import_react29.useState)(null);
    const latestProps = useLatestValue(props, Object.values(props));
    const draggableDescribedById = useUniqueId("DndDescribedBy", id);
    const enabledDroppableContainers = (0, import_react29.useMemo)(() => droppableContainers.getEnabled(), [droppableContainers]);
    const measuringConfiguration = useMeasuringConfiguration(measuring);
    const {
      droppableRects,
      measureDroppableContainers,
      measuringScheduled
    } = useDroppableMeasuring(enabledDroppableContainers, {
      dragging: isInitialized,
      dependencies: [translate.x, translate.y],
      config: measuringConfiguration.droppable
    });
    const activeNode = useCachedNode(draggableNodes, activeId);
    const activationCoordinates = (0, import_react29.useMemo)(() => activatorEvent ? getEventCoordinates(activatorEvent) : null, [activatorEvent]);
    const autoScrollOptions = getAutoScrollerOptions();
    const initialActiveNodeRect = useInitialRect(activeNode, measuringConfiguration.draggable.measure);
    useLayoutShiftScrollCompensation({
      activeNode: activeId != null ? draggableNodes.get(activeId) : null,
      config: autoScrollOptions.layoutShiftCompensation,
      initialRect: initialActiveNodeRect,
      measure: measuringConfiguration.draggable.measure
    });
    const activeNodeRect = useRect(activeNode, measuringConfiguration.draggable.measure, initialActiveNodeRect);
    const containerNodeRect = useRect(activeNode ? activeNode.parentElement : null);
    const sensorContext = (0, import_react29.useRef)({
      activatorEvent: null,
      active: null,
      activeNode,
      collisionRect: null,
      collisions: null,
      droppableRects,
      draggableNodes,
      draggingNode: null,
      draggingNodeRect: null,
      droppableContainers,
      over: null,
      scrollableAncestors: [],
      scrollAdjustedTranslate: null
    });
    const overNode = droppableContainers.getNodeFor((_sensorContext$curren = sensorContext.current.over) == null ? void 0 : _sensorContext$curren.id);
    const dragOverlay = useDragOverlayMeasuring({
      measure: measuringConfiguration.dragOverlay.measure
    });
    const draggingNode = (_dragOverlay$nodeRef$ = dragOverlay.nodeRef.current) != null ? _dragOverlay$nodeRef$ : activeNode;
    const draggingNodeRect = isInitialized ? (_dragOverlay$rect = dragOverlay.rect) != null ? _dragOverlay$rect : activeNodeRect : null;
    const usesDragOverlay = Boolean(dragOverlay.nodeRef.current && dragOverlay.rect);
    const nodeRectDelta = useRectDelta(usesDragOverlay ? null : activeNodeRect);
    const windowRect = useWindowRect(draggingNode ? getWindow2(draggingNode) : null);
    const scrollableAncestors = useScrollableAncestors(isInitialized ? overNode != null ? overNode : activeNode : null);
    const scrollableAncestorRects = useRects(scrollableAncestors);
    const modifiedTranslate = applyModifiers(modifiers, {
      transform: {
        x: translate.x - nodeRectDelta.x,
        y: translate.y - nodeRectDelta.y,
        scaleX: 1,
        scaleY: 1
      },
      activatorEvent,
      active,
      activeNodeRect,
      containerNodeRect,
      draggingNodeRect,
      over: sensorContext.current.over,
      overlayNodeRect: dragOverlay.rect,
      scrollableAncestors,
      scrollableAncestorRects,
      windowRect
    });
    const pointerCoordinates = activationCoordinates ? add(activationCoordinates, translate) : null;
    const scrollOffsets = useScrollOffsets(scrollableAncestors);
    const scrollAdjustment = useScrollOffsetsDelta(scrollOffsets);
    const activeNodeScrollDelta = useScrollOffsetsDelta(scrollOffsets, [activeNodeRect]);
    const scrollAdjustedTranslate = add(modifiedTranslate, scrollAdjustment);
    const collisionRect = draggingNodeRect ? getAdjustedRect(draggingNodeRect, modifiedTranslate) : null;
    const collisions = active && collisionRect ? collisionDetection({
      active,
      collisionRect,
      droppableRects,
      droppableContainers: enabledDroppableContainers,
      pointerCoordinates
    }) : null;
    const overId = getFirstCollision(collisions, "id");
    const [over, setOver] = (0, import_react29.useState)(null);
    const appliedTranslate = usesDragOverlay ? modifiedTranslate : add(modifiedTranslate, activeNodeScrollDelta);
    const transform = adjustScale(appliedTranslate, (_over$rect = over == null ? void 0 : over.rect) != null ? _over$rect : null, activeNodeRect);
    const activeSensorRef = (0, import_react29.useRef)(null);
    const instantiateSensor = (0, import_react29.useCallback)(
      (event, _ref22) => {
        let {
          sensor: Sensor,
          options
        } = _ref22;
        if (activeRef.current == null) {
          return;
        }
        const activeNode2 = draggableNodes.get(activeRef.current);
        if (!activeNode2) {
          return;
        }
        const activatorEvent2 = event.nativeEvent;
        const sensorInstance = new Sensor({
          active: activeRef.current,
          activeNode: activeNode2,
          event: activatorEvent2,
          options,
          // Sensors need to be instantiated with refs for arguments that change over time
          // otherwise they are frozen in time with the stale arguments
          context: sensorContext,
          onAbort(id2) {
            const draggableNode = draggableNodes.get(id2);
            if (!draggableNode) {
              return;
            }
            const {
              onDragAbort
            } = latestProps.current;
            const event2 = {
              id: id2
            };
            onDragAbort == null ? void 0 : onDragAbort(event2);
            dispatchMonitorEvent({
              type: "onDragAbort",
              event: event2
            });
          },
          onPending(id2, constraint, initialCoordinates, offset5) {
            const draggableNode = draggableNodes.get(id2);
            if (!draggableNode) {
              return;
            }
            const {
              onDragPending
            } = latestProps.current;
            const event2 = {
              id: id2,
              constraint,
              initialCoordinates,
              offset: offset5
            };
            onDragPending == null ? void 0 : onDragPending(event2);
            dispatchMonitorEvent({
              type: "onDragPending",
              event: event2
            });
          },
          onStart(initialCoordinates) {
            const id2 = activeRef.current;
            if (id2 == null) {
              return;
            }
            const draggableNode = draggableNodes.get(id2);
            if (!draggableNode) {
              return;
            }
            const {
              onDragStart
            } = latestProps.current;
            const event2 = {
              activatorEvent: activatorEvent2,
              active: {
                id: id2,
                data: draggableNode.data,
                rect: activeRects
              }
            };
            (0, import_react_dom6.unstable_batchedUpdates)(() => {
              onDragStart == null ? void 0 : onDragStart(event2);
              setStatus(Status.Initializing);
              dispatch({
                type: Action.DragStart,
                initialCoordinates,
                active: id2
              });
              dispatchMonitorEvent({
                type: "onDragStart",
                event: event2
              });
              setActiveSensor(activeSensorRef.current);
              setActivatorEvent(activatorEvent2);
            });
          },
          onMove(coordinates) {
            dispatch({
              type: Action.DragMove,
              coordinates
            });
          },
          onEnd: createHandler(Action.DragEnd),
          onCancel: createHandler(Action.DragCancel)
        });
        activeSensorRef.current = sensorInstance;
        function createHandler(type) {
          return async function handler() {
            const {
              active: active2,
              collisions: collisions2,
              over: over2,
              scrollAdjustedTranslate: scrollAdjustedTranslate2
            } = sensorContext.current;
            let event2 = null;
            if (active2 && scrollAdjustedTranslate2) {
              const {
                cancelDrop
              } = latestProps.current;
              event2 = {
                activatorEvent: activatorEvent2,
                active: active2,
                collisions: collisions2,
                delta: scrollAdjustedTranslate2,
                over: over2
              };
              if (type === Action.DragEnd && typeof cancelDrop === "function") {
                const shouldCancel = await Promise.resolve(cancelDrop(event2));
                if (shouldCancel) {
                  type = Action.DragCancel;
                }
              }
            }
            activeRef.current = null;
            (0, import_react_dom6.unstable_batchedUpdates)(() => {
              dispatch({
                type
              });
              setStatus(Status.Uninitialized);
              setOver(null);
              setActiveSensor(null);
              setActivatorEvent(null);
              activeSensorRef.current = null;
              const eventName = type === Action.DragEnd ? "onDragEnd" : "onDragCancel";
              if (event2) {
                const handler2 = latestProps.current[eventName];
                handler2 == null ? void 0 : handler2(event2);
                dispatchMonitorEvent({
                  type: eventName,
                  event: event2
                });
              }
            });
          };
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [draggableNodes]
    );
    const bindActivatorToSensorInstantiator = (0, import_react29.useCallback)((handler, sensor) => {
      return (event, active2) => {
        const nativeEvent = event.nativeEvent;
        const activeDraggableNode = draggableNodes.get(active2);
        if (
          // Another sensor is already instantiating
          activeRef.current !== null || // No active draggable
          !activeDraggableNode || // Event has already been captured
          nativeEvent.dndKit || nativeEvent.defaultPrevented
        ) {
          return;
        }
        const activationContext = {
          active: activeDraggableNode
        };
        const shouldActivate = handler(event, sensor.options, activationContext);
        if (shouldActivate === true) {
          nativeEvent.dndKit = {
            capturedBy: sensor.sensor
          };
          activeRef.current = active2;
          instantiateSensor(event, sensor);
        }
      };
    }, [draggableNodes, instantiateSensor]);
    const activators = useCombineActivators(sensors, bindActivatorToSensorInstantiator);
    useSensorSetup(sensors);
    useIsomorphicLayoutEffect2(() => {
      if (activeNodeRect && status === Status.Initializing) {
        setStatus(Status.Initialized);
      }
    }, [activeNodeRect, status]);
    (0, import_react29.useEffect)(
      () => {
        const {
          onDragMove
        } = latestProps.current;
        const {
          active: active2,
          activatorEvent: activatorEvent2,
          collisions: collisions2,
          over: over2
        } = sensorContext.current;
        if (!active2 || !activatorEvent2) {
          return;
        }
        const event = {
          active: active2,
          activatorEvent: activatorEvent2,
          collisions: collisions2,
          delta: {
            x: scrollAdjustedTranslate.x,
            y: scrollAdjustedTranslate.y
          },
          over: over2
        };
        (0, import_react_dom6.unstable_batchedUpdates)(() => {
          onDragMove == null ? void 0 : onDragMove(event);
          dispatchMonitorEvent({
            type: "onDragMove",
            event
          });
        });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [scrollAdjustedTranslate.x, scrollAdjustedTranslate.y]
    );
    (0, import_react29.useEffect)(
      () => {
        const {
          active: active2,
          activatorEvent: activatorEvent2,
          collisions: collisions2,
          droppableContainers: droppableContainers2,
          scrollAdjustedTranslate: scrollAdjustedTranslate2
        } = sensorContext.current;
        if (!active2 || activeRef.current == null || !activatorEvent2 || !scrollAdjustedTranslate2) {
          return;
        }
        const {
          onDragOver
        } = latestProps.current;
        const overContainer = droppableContainers2.get(overId);
        const over2 = overContainer && overContainer.rect.current ? {
          id: overContainer.id,
          rect: overContainer.rect.current,
          data: overContainer.data,
          disabled: overContainer.disabled
        } : null;
        const event = {
          active: active2,
          activatorEvent: activatorEvent2,
          collisions: collisions2,
          delta: {
            x: scrollAdjustedTranslate2.x,
            y: scrollAdjustedTranslate2.y
          },
          over: over2
        };
        (0, import_react_dom6.unstable_batchedUpdates)(() => {
          setOver(over2);
          onDragOver == null ? void 0 : onDragOver(event);
          dispatchMonitorEvent({
            type: "onDragOver",
            event
          });
        });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [overId]
    );
    useIsomorphicLayoutEffect2(() => {
      sensorContext.current = {
        activatorEvent,
        active,
        activeNode,
        collisionRect,
        collisions,
        droppableRects,
        draggableNodes,
        draggingNode,
        draggingNodeRect,
        droppableContainers,
        over,
        scrollableAncestors,
        scrollAdjustedTranslate
      };
      activeRects.current = {
        initial: draggingNodeRect,
        translated: collisionRect
      };
    }, [active, activeNode, collisions, collisionRect, draggableNodes, draggingNode, draggingNodeRect, droppableRects, droppableContainers, over, scrollableAncestors, scrollAdjustedTranslate]);
    useAutoScroller({
      ...autoScrollOptions,
      delta: translate,
      draggingRect: collisionRect,
      pointerCoordinates,
      scrollableAncestors,
      scrollableAncestorRects
    });
    const publicContext = (0, import_react29.useMemo)(() => {
      const context = {
        active,
        activeNode,
        activeNodeRect,
        activatorEvent,
        collisions,
        containerNodeRect,
        dragOverlay,
        draggableNodes,
        droppableContainers,
        droppableRects,
        over,
        measureDroppableContainers,
        scrollableAncestors,
        scrollableAncestorRects,
        measuringConfiguration,
        measuringScheduled,
        windowRect
      };
      return context;
    }, [active, activeNode, activeNodeRect, activatorEvent, collisions, containerNodeRect, dragOverlay, draggableNodes, droppableContainers, droppableRects, over, measureDroppableContainers, scrollableAncestors, scrollableAncestorRects, measuringConfiguration, measuringScheduled, windowRect]);
    const internalContext = (0, import_react29.useMemo)(() => {
      const context = {
        activatorEvent,
        activators,
        active,
        activeNodeRect,
        ariaDescribedById: {
          draggable: draggableDescribedById
        },
        dispatch,
        draggableNodes,
        over,
        measureDroppableContainers
      };
      return context;
    }, [activatorEvent, activators, active, activeNodeRect, dispatch, draggableDescribedById, draggableNodes, over, measureDroppableContainers]);
    return import_react29.default.createElement(DndMonitorContext.Provider, {
      value: registerMonitorListener
    }, import_react29.default.createElement(InternalContext.Provider, {
      value: internalContext
    }, import_react29.default.createElement(PublicContext.Provider, {
      value: publicContext
    }, import_react29.default.createElement(ActiveDraggableContext.Provider, {
      value: transform
    }, children)), import_react29.default.createElement(RestoreFocus, {
      disabled: (accessibility == null ? void 0 : accessibility.restoreFocus) === false
    })), import_react29.default.createElement(Accessibility, {
      ...accessibility,
      hiddenTextDescribedById: draggableDescribedById
    }));
    function getAutoScrollerOptions() {
      const activeSensorDisablesAutoscroll = (activeSensor == null ? void 0 : activeSensor.autoScrollEnabled) === false;
      const autoScrollGloballyDisabled = typeof autoScroll === "object" ? autoScroll.enabled === false : autoScroll === false;
      const enabled = isInitialized && !activeSensorDisablesAutoscroll && !autoScrollGloballyDisabled;
      if (typeof autoScroll === "object") {
        return {
          ...autoScroll,
          enabled
        };
      }
      return {
        enabled
      };
    }
  });
  var NullContext = /* @__PURE__ */ (0, import_react29.createContext)(null);
  var defaultRole = "button";
  var ID_PREFIX = "Draggable";
  function useDraggable(_ref2) {
    let {
      id,
      data,
      disabled = false,
      attributes
    } = _ref2;
    const key = useUniqueId(ID_PREFIX);
    const {
      activators,
      activatorEvent,
      active,
      activeNodeRect,
      ariaDescribedById,
      draggableNodes,
      over
    } = (0, import_react29.useContext)(InternalContext);
    const {
      role = defaultRole,
      roleDescription = "draggable",
      tabIndex = 0
    } = attributes != null ? attributes : {};
    const isDragging = (active == null ? void 0 : active.id) === id;
    const transform = (0, import_react29.useContext)(isDragging ? ActiveDraggableContext : NullContext);
    const [node, setNodeRef] = useNodeRef();
    const [activatorNode, setActivatorNodeRef] = useNodeRef();
    const listeners = useSyntheticListeners(activators, id);
    const dataRef = useLatestValue(data);
    useIsomorphicLayoutEffect2(
      () => {
        draggableNodes.set(id, {
          id,
          key,
          node,
          activatorNode,
          data: dataRef
        });
        return () => {
          const node2 = draggableNodes.get(id);
          if (node2 && node2.key === key) {
            draggableNodes.delete(id);
          }
        };
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [draggableNodes, id]
    );
    const memoizedAttributes = (0, import_react29.useMemo)(() => ({
      role,
      tabIndex,
      "aria-disabled": disabled,
      "aria-pressed": isDragging && role === defaultRole ? true : void 0,
      "aria-roledescription": roleDescription,
      "aria-describedby": ariaDescribedById.draggable
    }), [disabled, role, tabIndex, isDragging, roleDescription, ariaDescribedById.draggable]);
    return {
      active,
      activatorEvent,
      activeNodeRect,
      attributes: memoizedAttributes,
      isDragging,
      listeners: disabled ? void 0 : listeners,
      node,
      over,
      setNodeRef,
      setActivatorNodeRef,
      transform
    };
  }
  var ID_PREFIX$1 = "Droppable";
  var defaultResizeObserverConfig = {
    timeout: 25
  };
  function useDroppable(_ref2) {
    let {
      data,
      disabled = false,
      id,
      resizeObserverConfig
    } = _ref2;
    const key = useUniqueId(ID_PREFIX$1);
    const {
      active,
      dispatch,
      over,
      measureDroppableContainers
    } = (0, import_react29.useContext)(InternalContext);
    const previous = (0, import_react29.useRef)({
      disabled
    });
    const resizeObserverConnected = (0, import_react29.useRef)(false);
    const rect = (0, import_react29.useRef)(null);
    const callbackId = (0, import_react29.useRef)(null);
    const {
      disabled: resizeObserverDisabled,
      updateMeasurementsFor,
      timeout: resizeObserverTimeout
    } = {
      ...defaultResizeObserverConfig,
      ...resizeObserverConfig
    };
    const ids2 = useLatestValue(updateMeasurementsFor != null ? updateMeasurementsFor : id);
    const handleResize = (0, import_react29.useCallback)(
      () => {
        if (!resizeObserverConnected.current) {
          resizeObserverConnected.current = true;
          return;
        }
        if (callbackId.current != null) {
          clearTimeout(callbackId.current);
        }
        callbackId.current = setTimeout(() => {
          measureDroppableContainers(Array.isArray(ids2.current) ? ids2.current : [ids2.current]);
          callbackId.current = null;
        }, resizeObserverTimeout);
      },
      //eslint-disable-next-line react-hooks/exhaustive-deps
      [resizeObserverTimeout]
    );
    const resizeObserver = useResizeObserver({
      callback: handleResize,
      disabled: resizeObserverDisabled || !active
    });
    const handleNodeChange = (0, import_react29.useCallback)((newElement, previousElement) => {
      if (!resizeObserver) {
        return;
      }
      if (previousElement) {
        resizeObserver.unobserve(previousElement);
        resizeObserverConnected.current = false;
      }
      if (newElement) {
        resizeObserver.observe(newElement);
      }
    }, [resizeObserver]);
    const [nodeRef, setNodeRef] = useNodeRef(handleNodeChange);
    const dataRef = useLatestValue(data);
    (0, import_react29.useEffect)(() => {
      if (!resizeObserver || !nodeRef.current) {
        return;
      }
      resizeObserver.disconnect();
      resizeObserverConnected.current = false;
      resizeObserver.observe(nodeRef.current);
    }, [nodeRef, resizeObserver]);
    (0, import_react29.useEffect)(
      () => {
        dispatch({
          type: Action.RegisterDroppable,
          element: {
            id,
            key,
            disabled,
            node: nodeRef,
            rect,
            data: dataRef
          }
        });
        return () => dispatch({
          type: Action.UnregisterDroppable,
          key,
          id
        });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [id]
    );
    (0, import_react29.useEffect)(() => {
      if (disabled !== previous.current.disabled) {
        dispatch({
          type: Action.SetDroppableDisabled,
          id,
          key,
          disabled
        });
        previous.current.disabled = disabled;
      }
    }, [id, key, disabled, dispatch]);
    return {
      active,
      rect,
      isOver: (over == null ? void 0 : over.id) === id,
      node: nodeRef,
      over,
      setNodeRef
    };
  }

  // src/components/grid-layout/draggable.tsx
  var import_react34 = __toESM(require_react());

  // ../../node_modules/.pnpm/@react-hook+passive-layout-effect@1.2.1_react@19.2.3/node_modules/@react-hook/passive-layout-effect/dist/module/index.js
  var import_react30 = __toESM(require_react());
  var usePassiveLayoutEffect = import_react30.default[typeof document !== "undefined" && document.createElement !== void 0 ? "useLayoutEffect" : "useEffect"];
  var module_default = usePassiveLayoutEffect;

  // ../../node_modules/.pnpm/@react-hook+latest@1.0.3_react@19.2.3/node_modules/@react-hook/latest/dist/module/index.js
  var React63 = __toESM(require_react());
  var useLatest = (current) => {
    const storedValue = React63.useRef(current);
    React63.useEffect(() => {
      storedValue.current = current;
    });
    return storedValue;
  };
  var module_default2 = useLatest;

  // ../../node_modules/.pnpm/@react-hook+resize-observer@2.0.2_react@19.2.3/node_modules/@react-hook/resize-observer/dist/module/index.js
  function _ref() {
  }
  function useResizeObserver2(target, callback, options = {}) {
    const resizeObserver = getResizeObserver(options.polyfill);
    const storedCallback = module_default2(callback);
    module_default(() => {
      let didUnsubscribe = false;
      const targetEl = target && "current" in target ? target.current : target;
      if (!targetEl) return _ref;
      function cb(entry, observer) {
        if (didUnsubscribe) return;
        storedCallback.current(entry, observer);
      }
      resizeObserver.subscribe(targetEl, cb);
      return () => {
        didUnsubscribe = true;
        resizeObserver.unsubscribe(targetEl, cb);
      };
    }, [target, resizeObserver, storedCallback]);
    return resizeObserver.observer;
  }
  function createResizeObserver(polyfill) {
    let ticking = false;
    let allEntries = [];
    const callbacks = /* @__PURE__ */ new Map();
    const observer = new (polyfill || window.ResizeObserver)((entries, obs) => {
      allEntries = allEntries.concat(entries);
      function _ref2() {
        const triggered = /* @__PURE__ */ new Set();
        for (let i = 0; i < allEntries.length; i++) {
          if (triggered.has(allEntries[i].target)) continue;
          triggered.add(allEntries[i].target);
          const cbs = callbacks.get(allEntries[i].target);
          cbs === null || cbs === void 0 ? void 0 : cbs.forEach((cb) => cb(allEntries[i], obs));
        }
        allEntries = [];
        ticking = false;
      }
      if (!ticking) {
        window.requestAnimationFrame(_ref2);
      }
      ticking = true;
    });
    return {
      observer,
      subscribe(target, callback) {
        var _callbacks$get;
        observer.observe(target);
        const cbs = (_callbacks$get = callbacks.get(target)) !== null && _callbacks$get !== void 0 ? _callbacks$get : [];
        cbs.push(callback);
        callbacks.set(target, cbs);
      },
      unsubscribe(target, callback) {
        var _callbacks$get2;
        const cbs = (_callbacks$get2 = callbacks.get(target)) !== null && _callbacks$get2 !== void 0 ? _callbacks$get2 : [];
        if (cbs.length === 1) {
          observer.unobserve(target);
          callbacks.delete(target);
          return;
        }
        const cbIndex = cbs.indexOf(callback);
        if (cbIndex !== -1) cbs.splice(cbIndex, 1);
        callbacks.set(target, cbs);
      }
    };
  }
  var _resizeObserver;
  var getResizeObserver = (polyfill) => !_resizeObserver ? _resizeObserver = createResizeObserver(polyfill) : _resizeObserver;
  var module_default3 = useResizeObserver2;

  // src/components/grid-layout/grid.tsx
  var import_react32 = __toESM(require_react());
  var SwappableWidgetInstanceGridContext = import_react32.default.createContext({
    isEditing: false
  });
  function BigIconButton({ icon, children, ...props }) {
    return /* @__PURE__ */ jsxs(
      DesignButton,
      {
        variant: "outline",
        className: "h-20 w-20 p-1 rounded-full backdrop-blur-md bg-slate-200/20 dark:bg-black/20",
        ...props,
        children: [
          icon,
          children
        ]
      }
    );
  }
  function SwappableWidgetInstanceGrid(props) {
    const dispatchGridStateChange = (0, import_react32.useCallback)((grid) => {
      window.dispatchEvent(new CustomEvent("grid-state-change", { detail: { serializedGrid: grid.serialize() } }));
    }, []);
    const effectiveUnitHeight = props.unitHeight ?? gridUnitHeight;
    const effectiveGapPixels = props.gapPixels ?? gridGapPixels;
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
    const [resizedElements, setResizedElements] = (0, import_react32.useState)(/* @__PURE__ */ new Set());
    const [draggingType, setDraggingType] = (0, import_react32.useState)(null);
    const [overElementPosition, setOverElementPosition] = (0, import_react32.useState)(null);
    const [overVarHeightSlot, setOverVarHeightSlot] = (0, import_react32.useState)(null);
    const [activeWidgetId, setActiveInstanceId] = (0, import_react32.useState)(null);
    const [hoverElementSwap, setHoverElementSwap] = (0, import_react32.useState)(null);
    const [hoverSwapBlocked, setHoverSwapBlocked] = (0, import_react32.useState)(null);
    const [justSwappedActiveId, setJustSwappedActiveId] = (0, import_react32.useState)(null);
    const [justSwappedPartnerId, setJustSwappedPartnerId] = (0, import_react32.useState)(null);
    const [resizeBlocked, setResizeBlocked] = (0, import_react32.useState)({ top: false, left: false, right: false, bottom: false });
    const [resizingInstanceId, setResizingInstanceId] = (0, import_react32.useState)(null);
    const gridContainerRef = (0, import_react32.useRef)(null);
    const dropRectsRef = (0, import_react32.useRef)(/* @__PURE__ */ new Map());
    const context = import_react32.default.useContext(SwappableWidgetInstanceGridContext);
    const [windowLayoutEditing, setWindowLayoutEditing] = (0, import_react32.useState)(false);
    import_react32.default.useEffect(() => {
      const handler = () => setWindowLayoutEditing(!!window.__layoutEditing);
      window.addEventListener("layout-edit-change", handler);
      handler();
      return () => window.removeEventListener("layout-edit-change", handler);
    }, []);
    const [windowSelectingForEdit, setWindowSelectingForEdit] = (0, import_react32.useState)(false);
    import_react32.default.useEffect(() => {
      const handler = () => setWindowSelectingForEdit(!!window.__selectingForEdit);
      window.addEventListener("selecting-for-edit-change", handler);
      handler();
      return () => window.removeEventListener("selecting-for-edit-change", handler);
    }, []);
    const effectiveIsEditing = context.isEditing || windowLayoutEditing;
    (0, import_react32.useEffect)(() => {
      const handler = () => {
        setResizeBlocked({ top: false, left: false, right: false, bottom: false });
        setResizingInstanceId(null);
      };
      window.addEventListener("mouseup", handler);
      return () => window.removeEventListener("mouseup", handler);
    }, []);
    const [isSingleColumnModeIfAuto, setMobileModeIfAuto] = (0, import_react32.useState)(false);
    module_default3(gridContainerRef, (entry) => {
      const shouldBeMobileMode = entry.contentRect.width < mobileModeCutoffWidth;
      if (isSingleColumnModeIfAuto !== shouldBeMobileMode) {
        setMobileModeIfAuto(shouldBeMobileMode);
      }
    });
    const isSingleColumnMode = props.isSingleColumnMode === "auto" ? isSingleColumnModeIfAuto : props.isSingleColumnMode;
    let hasAlreadyRenderedEmpty = false;
    const varHeights = props.gridRef.current.varHeights();
    return /* @__PURE__ */ jsxs(TooltipProvider2, { children: [
      /* @__PURE__ */ jsxs(
        "div",
        {
          ref: gridContainerRef,
          style: {
            ...isSingleColumnMode ? {
              display: "flex",
              flexDirection: "column"
            } : {
              display: "grid",
              gridTemplateColumns: `repeat(${props.gridRef.current.width}, 1fr)`,
              gridTemplateRows: `repeat(${2 * props.gridRef.current.height + 1}, auto)`
            },
            userSelect: "none",
            WebkitUserSelect: "none",
            overflow: "none",
            isolation: "isolate"
          },
          children: [
            !isSingleColumnMode && !props.fitContent && range(props.gridRef.current.height).map((y) => /* @__PURE__ */ jsx("div", { style: { height: effectiveUnitHeight, gridColumn: `1 / ${props.gridRef.current.width + 1}`, gridRow: `${2 * y + 2} / ${2 * y + 3}` } }, y)),
            /* @__PURE__ */ jsx(
              DndContext,
              {
                sensors,
                onDragStart: (event) => {
                  setActiveInstanceId(event.active.id);
                  setDraggingType("var-height");
                },
                onDragAbort: () => {
                  setActiveInstanceId(null);
                  setOverVarHeightSlot(null);
                  setDraggingType(null);
                },
                onDragCancel: () => {
                  setActiveInstanceId(null);
                  setOverVarHeightSlot(null);
                  setDraggingType(null);
                },
                onDragEnd: (event) => {
                  setActiveInstanceId(null);
                  setOverVarHeightSlot(null);
                  setDraggingType(null);
                  const activeInstanceId = event.active.id;
                  if (event.over) {
                    const overLocation = JSON.parse(`${event.over.id}`);
                    if (overLocation[0] === "before") {
                      props.gridRef.set(props.gridRef.current.withMovedVarHeightToInstance(activeInstanceId, overLocation[1], overLocation[0]));
                    } else {
                      props.gridRef.set(props.gridRef.current.withMovedVarHeightToEndOf(activeInstanceId, overLocation[1]));
                    }
                  }
                },
                onDragOver: (event) => {
                  const over = event.over;
                  if (!over) {
                    setOverVarHeightSlot(null);
                  } else {
                    const overLocation = JSON.parse(`${over.id}`);
                    setOverVarHeightSlot(overLocation);
                  }
                },
                collisionDetection: closestCenter,
                children: range(props.gridRef.current.height + 1).map((y) => /* @__PURE__ */ jsx("div", { style: {
                  gridColumn: `1 / -1`,
                  gridRow: `${2 * y + 1} / ${2 * y + 2}`,
                  display: "flex",
                  flexDirection: "column"
                }, children: [...varHeights.get(y) ?? [], null].map((instance, i) => {
                  if (instance !== null && !props.allowVariableHeight) {
                    throw new StackAssertionError("Variable height widgets are not allowed in this component", { instance });
                  }
                  const location = instance ? ["before", instance.id] : ["end-of", y];
                  const isOverVarHeightSlot = deepPlainEquals(overVarHeightSlot, location);
                  return /* @__PURE__ */ jsxs(import_react32.default.Fragment, { children: [
                    props.gridRef.current.canAddVarHeight(y) && /* @__PURE__ */ jsx("div", { className: "relative", children: /* @__PURE__ */ jsx(VarHeightSlot, { isOver: isOverVarHeightSlot, location }) }),
                    instance !== null && /* @__PURE__ */ jsx(
                      "div",
                      {
                        style: {
                          margin: effectiveGapPixels / 2
                        },
                        children: /* @__PURE__ */ jsx(
                          Draggable,
                          {
                            isStatic: props.isStatic,
                            type: "var-height",
                            widgetInstance: instance,
                            activeWidgetId,
                            isEditing: effectiveIsEditing,
                            selectingForEdit: windowSelectingForEdit,
                            isSingleColumnMode,
                            onDeleteWidget: async () => {
                              props.gridRef.set(props.gridRef.current.withRemovedVarHeight(instance.id));
                            },
                            settings: getSettings(instance),
                            setSettings: async (updater) => {
                              props.gridRef.set(props.gridRef.current.withUpdatedVarHeightSettings(instance.id, updater));
                            },
                            stateRef: mapRefState(
                              props.gridRef,
                              (grid) => {
                                const newInstance = grid.getVarHeightInstanceById(instance.id);
                                return getState2(newInstance ?? instance);
                              },
                              (grid, state) => {
                                return props.gridRef.current.withUpdatedVarHeightState(instance.id, state);
                              }
                            ),
                            onResize: () => {
                              throw new StackAssertionError("Cannot resize a var-height widget!");
                            },
                            x: 0,
                            y,
                            width: props.gridRef.current.width,
                            height: 1,
                            calculateUnitSize: () => {
                              const gridContainerRect = gridContainerRef.current?.getBoundingClientRect() ?? throwErr(`Grid container not found`);
                              const gridContainerWidth = gridContainerRect.width;
                              const gridContainerWidthWithoutGaps = gridContainerWidth - (props.gridRef.current.width - 1) * effectiveGapPixels;
                              const unitWidth = Math.round(gridContainerWidthWithoutGaps / props.gridRef.current.width) + effectiveGapPixels;
                              return { width: unitWidth, height: effectiveUnitHeight };
                            }
                          }
                        )
                      }
                    )
                  ] }, i);
                }) }, y))
              }
            ),
            /* @__PURE__ */ jsx(
              DndContext,
              {
                sensors,
                onDragStart: (event) => {
                  setActiveInstanceId(event.active.id);
                  setDraggingType("element");
                },
                onDragAbort: () => {
                  setHoverElementSwap(null);
                  setHoverSwapBlocked(null);
                  setActiveInstanceId(null);
                  setOverElementPosition(null);
                  setDraggingType(null);
                },
                onDragCancel: () => {
                  setHoverElementSwap(null);
                  setHoverSwapBlocked(null);
                  setActiveInstanceId(null);
                  setOverElementPosition(null);
                  setDraggingType(null);
                },
                onDragEnd: (event) => {
                  const widgetId = event.active.id;
                  const widgetElement = [...props.gridRef.current.elements()].find(({ instance }) => instance?.id === widgetId);
                  if (!widgetElement) {
                    throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
                  }
                  if (event.over) {
                    const overCoordinates = JSON.parse(`${event.over.id}`);
                    const overElement = props.gridRef.current.getElementAt(overCoordinates[0], overCoordinates[1]);
                    if (overElement.instance === null) {
                      const newGrid = props.gridRef.current.withMovedElementTo(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1]);
                      const activeId = event.active.id;
                      setJustSwappedActiveId(activeId);
                      setTimeout(() => setJustSwappedActiveId(null), 300);
                      props.gridRef.set(newGrid);
                      dispatchGridStateChange(newGrid);
                    } else if (props.gridRef.current.canSwap(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1])) {
                      const activeId = event.active.id;
                      const partnerId = overElement.instance.id;
                      setJustSwappedActiveId(activeId);
                      setJustSwappedPartnerId(partnerId);
                      setTimeout(() => {
                        setJustSwappedActiveId(null);
                        setJustSwappedPartnerId(null);
                      }, 300);
                      const newGrid = props.gridRef.current.withSwappedElements(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1]);
                      props.gridRef.set(newGrid);
                      dispatchGridStateChange(newGrid);
                    } else {
                      alert("Cannot swap elements; make sure the new locations are big enough for the widgets");
                    }
                  }
                  setHoverElementSwap(null);
                  setHoverSwapBlocked(null);
                  setActiveInstanceId(null);
                  setOverElementPosition(null);
                  setDraggingType(null);
                },
                onDragOver: (event) => {
                  const widgetId = event.active.id;
                  const widgetElement = [...props.gridRef.current.elements()].find(({ instance }) => instance?.id === widgetId);
                  if (!widgetElement) {
                    throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
                  }
                  if (event.over) {
                    if (!event.active.rect.current.initial) {
                    } else {
                      const overCoordinates = JSON.parse(`${event.over.id}`);
                      const overElement = props.gridRef.current.getElementAt(overCoordinates[0], overCoordinates[1]);
                      const overId = overElement.instance?.id;
                      if (overElement.instance === null) {
                        setOverElementPosition(overCoordinates);
                        setHoverElementSwap(null);
                        setHoverSwapBlocked(null);
                      } else if (props.gridRef.current.canSwap(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1])) {
                        setOverElementPosition(overCoordinates);
                        if (overId && overId !== widgetId) {
                          setHoverElementSwap(overId);
                          setHoverSwapBlocked(null);
                        } else {
                          setHoverElementSwap(null);
                          setHoverSwapBlocked(null);
                        }
                      } else {
                        setOverElementPosition(null);
                        setHoverElementSwap(null);
                        if (overId && overId !== widgetId) {
                          setHoverSwapBlocked(overId);
                        } else {
                          setHoverSwapBlocked(null);
                        }
                      }
                    }
                  } else {
                    setOverElementPosition(null);
                    setHoverElementSwap(null);
                    setHoverSwapBlocked(null);
                  }
                },
                collisionDetection: pointerWithin,
                children: props.gridRef.current.elements().map(({ instance, x, y, width, height }) => {
                  if (isSingleColumnMode && !instance) {
                    if (hasAlreadyRenderedEmpty) return null;
                    hasAlreadyRenderedEmpty = true;
                  }
                  return /* @__PURE__ */ jsx(
                    ElementSlot,
                    {
                      isSingleColumnMode,
                      instanceId: instance?.id,
                      dropRectsRef,
                      isEmpty: !instance,
                      isEditing: effectiveIsEditing,
                      isOver: overElementPosition?.[0] === x && overElementPosition[1] === y,
                      x,
                      y,
                      width,
                      height,
                      grid: props.gridRef.current,
                      gapPixels: effectiveGapPixels,
                      minHeight: instance && resizedElements.has(instance.id) ? height * effectiveUnitHeight : !instance && activeWidgetId !== null && y + height >= props.gridRef.current.height ? WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT * effectiveUnitHeight : void 0,
                      isActive: instance?.id === activeWidgetId,
                      skipFlip: instance?.id === justSwappedActiveId || instance?.id === justSwappedPartnerId,
                      onAddWidget: props.isStatic ? void 0 : () => {
                        window.dispatchEvent(new CustomEvent("widget-add-request", {
                          detail: { x, y, width, height }
                        }));
                      },
                      children: instance && (() => {
                        const elementFitContent = props.fitContent && !resizedElements.has(instance.id);
                        const isHoverSwapped = hoverElementSwap === instance.id;
                        const isSwapBlocked = hoverSwapBlocked === instance.id;
                        return /* @__PURE__ */ jsx(
                          Draggable,
                          {
                            isStatic: props.isStatic,
                            type: "element",
                            fitContent: elementFitContent,
                            widgetInstance: instance,
                            activeWidgetId,
                            isEditing: effectiveIsEditing,
                            selectingForEdit: windowSelectingForEdit,
                            resizeBlocked: resizingInstanceId === instance.id ? resizeBlocked : void 0,
                            style: isSwapBlocked ? { opacity: 0.5, transform: "scale(0.95)", outline: "2px solid #ef4444", outlineOffset: "-2px", borderRadius: "8px" } : isHoverSwapped ? { opacity: 0.5, transform: "scale(0.95)" } : {},
                            isSingleColumnMode,
                            onDeleteWidget: async () => {
                              props.gridRef.set(props.gridRef.current.withRemovedElement(x, y));
                            },
                            settings: getSettings(instance),
                            setSettings: async (updater) => {
                              props.gridRef.set(props.gridRef.current.withUpdatedElementSettings(x, y, updater));
                            },
                            stateRef: mapRefState(
                              props.gridRef,
                              (grid) => {
                                const newElement = grid.getElementByInstanceId(instance.id);
                                return getState2(newElement?.instance ?? instance);
                              },
                              (grid, state) => grid.withUpdatedElementState(x, y, state)
                            ),
                            onResize: (edges, visualHeight) => {
                              setResizingInstanceId(instance.id);
                              let currentGrid = props.gridRef.current;
                              if (elementFitContent) {
                                setResizedElements((prev) => new Set(prev).add(instance.id));
                                if (visualHeight != null) {
                                  const snappedHeight = Math.max(
                                    WidgetInstanceGrid.MIN_ELEMENT_HEIGHT,
                                    Math.ceil(visualHeight / effectiveUnitHeight)
                                  );
                                  if (snappedHeight !== height) {
                                    const snapDelta = { top: 0, left: 0, bottom: snappedHeight - height, right: 0 };
                                    const snapClamped = currentGrid.clampElementResize(x, y, snapDelta);
                                    if (snapClamped.bottom !== 0) {
                                      currentGrid = currentGrid.withResizedElement(x, y, snapClamped);
                                    }
                                  }
                                }
                              }
                              const { grid: newGrid, achievedDelta, blocked } = currentGrid.withResizedElementAndPush(x, y, edges);
                              props.gridRef.set(newGrid);
                              dispatchGridStateChange(newGrid);
                              setResizeBlocked(blocked);
                              return achievedDelta;
                            },
                            x,
                            y,
                            width,
                            height,
                            calculateUnitSize: () => {
                              const gridContainerRect = gridContainerRef.current?.getBoundingClientRect() ?? throwErr(`Grid container not found`);
                              const gridContainerWidth = gridContainerRect.width;
                              const gridContainerWidthWithoutGaps = gridContainerWidth - (props.gridRef.current.width - 1) * effectiveGapPixels;
                              const unitWidth = Math.round(gridContainerWidthWithoutGaps / props.gridRef.current.width) + effectiveGapPixels;
                              return { width: unitWidth, height: effectiveUnitHeight };
                            }
                          }
                        );
                      })()
                    },
                    instance?.id ?? JSON.stringify({ x, y })
                  );
                })
              }
            )
          ]
        }
      ),
      effectiveIsEditing && !props.isStatic && /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            margin: effectiveGapPixels / 2,
            minHeight: WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT * effectiveUnitHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "8px dotted #88888822",
            borderRadius: "16px",
            opacity: 0,
            animation: "stack-animation-fade-in 400ms 50ms ease forwards"
          },
          children: /* @__PURE__ */ jsx(
            BigIconButton,
            {
              icon: /* @__PURE__ */ jsx(n, { size: 24, weight: "bold" }),
              onClick: () => {
                window.dispatchEvent(new CustomEvent("widget-add-request", {
                  detail: {
                    x: 0,
                    y: props.gridRef.current.height,
                    width: props.gridRef.current.width,
                    height: WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT
                  }
                }));
              }
            }
          )
        }
      )
    ] });
  }
  function VarHeightSlot(props) {
    const { setNodeRef } = useDroppable({
      id: JSON.stringify(props.location)
    });
    return /* @__PURE__ */ jsx(
      "div",
      {
        ...{ inert: true },
        ref: setNodeRef,
        style: {
          position: "absolute",
          width: "100%",
          height: 4,
          transform: "translateY(-50%)",
          backgroundColor: props.isOver ? "#0000ff88" : "transparent"
        }
      }
    );
  }
  function ElementSlot(props) {
    const { setNodeRef } = useDroppable({
      id: JSON.stringify([props.x, props.y])
    });
    const divRef = (0, import_react32.useRef)(null);
    const prevRectRef = (0, import_react32.useRef)(null);
    const flipAnimRef = (0, import_react32.useRef)(null);
    const isActiveRef = (0, import_react32.useRef)(props.isActive);
    isActiveRef.current = props.isActive;
    const mergedRef = (0, import_react32.useCallback)((el) => {
      divRef.current = el;
      setNodeRef(el);
    }, [setNodeRef]);
    (0, import_react32.useLayoutEffect)(() => {
      if (!divRef.current) return;
      const el = divRef.current;
      if (flipAnimRef.current) {
        flipAnimRef.current.cancel();
        flipAnimRef.current = null;
      }
      const newRect = el.getBoundingClientRect();
      const dropRect = props.instanceId ? props.dropRectsRef?.current?.get(props.instanceId) : null;
      if (dropRect && props.instanceId) {
        props.dropRectsRef?.current?.delete(props.instanceId);
      }
      const fromRect = dropRect ?? prevRectRef.current;
      if (fromRect && !props.isEmpty && !props.skipFlip) {
        const dx = fromRect.left - newRect.left;
        const dy = fromRect.top - newRect.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          flipAnimRef.current = el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
            { duration: 150, easing: "ease-out" }
          );
        }
      }
      prevRectRef.current = newRect;
    }, [props.x, props.y, props.width, props.height, props.instanceId, props.dropRectsRef, props.skipFlip]);
    const gap = props.gapPixels ?? gridGapPixels;
    const meetsMinSize = props.width >= WidgetInstanceGrid.MIN_ELEMENT_WIDTH && props.height >= WidgetInstanceGrid.MIN_ELEMENT_HEIGHT;
    const shouldRenderEmptyIndicator = props.isEmpty && props.isEditing && meetsMinSize;
    const shouldShowPlusButton = shouldRenderEmptyIndicator && !!props.onAddWidget;
    return /* @__PURE__ */ jsxs(
      "div",
      {
        ref: mergedRef,
        style: {
          position: "relative",
          display: "flex",
          minWidth: 0,
          backgroundColor: props.isOver ? "#88888822" : void 0,
          borderRadius: "8px",
          gridColumn: `${props.x + 1} / span ${props.width}`,
          gridRow: `${2 * props.y + 2} / span ${2 * props.height - 1}`,
          margin: gap / 2,
          minHeight: props.minHeight,
          ...props.style
        },
        children: [
          /* @__PURE__ */ jsx("style", { children: `
        @keyframes stack-animation-fade-in {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }
    ` }),
          shouldRenderEmptyIndicator && /* @__PURE__ */ jsx(Fragment8, { children: /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
                border: "8px dotted #88888822",
                borderRadius: "16px",
                animation: "stack-animation-fade-in 400ms 50ms ease forwards",
                opacity: 0
              },
              children: shouldShowPlusButton && /* @__PURE__ */ jsx(BigIconButton, { icon: /* @__PURE__ */ jsx(n, { size: 24, weight: "bold" }), onClick: () => {
                props.onAddWidget();
              } })
            }
          ) }),
          props.children
        ]
      }
    );
  }

  // src/components/grid-layout/draggable.tsx
  var GridErrorBoundary = class extends import_react34.default.Component {
    constructor(props) {
      super(props);
      this.state = { error: null, hasError: false };
    }
    static getDerivedStateFromError(error) {
      return { error, hasError: true };
    }
    render() {
      if (this.state.hasError) {
        return this.props.fallback(this.state.error, () => this.setState({ error: null, hasError: false }));
      }
      return this.props.children;
    }
  };
  function errorToString2(error) {
    if (error instanceof Error) return error.stack ?? error.message;
    return String(error);
  }
  function BigIconButton2({ icon, children, ...props }) {
    return /* @__PURE__ */ jsxs(
      DesignButton,
      {
        variant: "outline",
        className: cn("h-20 w-20 p-1 rounded-full backdrop-blur-md bg-slate-200/20 dark:bg-black/20"),
        ...props,
        children: [
          icon,
          children
        ]
      }
    );
  }
  function Draggable(props) {
    const [isSettingsOpen, setIsSettingsOpenRaw] = (0, import_react34.useState)(false);
    const [unsavedSettings, setUnsavedSettings] = (0, import_react34.useState)(props.settings);
    const [settingsClosingAnimationCounter, setSettingsClosingAnimationCounter] = (0, import_react34.useState)(0);
    const [isDeleting, setIsDeleting] = (0, import_react34.useState)(false);
    const [confirmingDelete, setConfirmingDelete] = (0, import_react34.useState)(false);
    const [isEditingSubGrid, setIsEditingSubGrid] = (0, import_react34.useState)(false);
    const [isHovered, setIsHovered] = (0, import_react34.useState)(false);
    const isEditing = props.isEditing && !isEditingSubGrid;
    const selectingForEdit = !!props.selectingForEdit;
    const showOverlay = isEditing;
    const showHoverOverlay = selectingForEdit && isHovered;
    const [settingsOpenAnimationDetails, setSettingsOpenAnimationDetails] = (0, import_react34.useState)(null);
    const setIsSettingsOpen = (0, import_react34.useCallback)((value) => {
      if (value) {
        setSettingsOpenAnimationDetails(null);
        setUnsavedSettings(props.settings);
        setIsSettingsOpenRaw(true);
      } else {
        setSettingsOpenAnimationDetails(settingsOpenAnimationDetails ? { ...settingsOpenAnimationDetails, revert: true } : null);
        setIsSettingsOpenRaw(false);
        setSettingsClosingAnimationCounter((c3) => c3 + 1);
        setTimeout(() => setSettingsClosingAnimationCounter((c3) => c3 - 1), 1e3);
      }
    }, [settingsOpenAnimationDetails, props.settings]);
    const dragDisabled = !isEditing || props.isStatic;
    const { attributes, listeners, setNodeRef, transform, isDragging, node: draggableContainerRef } = useDraggable({
      id: props.widgetInstance.id,
      disabled: dragDisabled
    });
    const dialogRef = (0, import_react34.useRef)(null);
    (0, import_react34.useEffect)(() => {
      if (!props.isEditing) {
        setIsEditingSubGrid(false);
      }
    }, [props.isEditing]);
    const isFixedHeight = !props.fitContent && !props.isSingleColumnMode && props.type === "element";
    const isCompact = props.height <= 3;
    (0, import_react34.useEffect)(() => {
      let cancelled = false;
      if (isSettingsOpen) {
        if (!settingsOpenAnimationDetails) {
          runAsynchronouslyWithAlert(async () => {
            if (!draggableContainerRef.current) throw new StackAssertionError("Draggable container not found", { draggableContainerRef });
            for (let i = 0; i < 100; i++) {
              if (cancelled) return;
              if (dialogRef.current) break;
              await wait(10 + 3 * i);
            }
            if (!dialogRef.current) throw new StackAssertionError("Dialog ref not found even after waiting", { dialogRef });
            if (cancelled) return;
            const draggableContainerRect = draggableContainerRef.current.getBoundingClientRect();
            const dialogRect = dialogRef.current.getBoundingClientRect();
            const draggableContainerCenterCoordinates = [
              draggableContainerRect.x + draggableContainerRect.width / 2,
              draggableContainerRect.y + draggableContainerRect.height / 2
            ];
            const dialogCenterCoordinates = [
              dialogRect.x + dialogRect.width / 2,
              dialogRect.y + dialogRect.height / 2
            ];
            const scale = [
              draggableContainerRect.width / dialogRect.width,
              draggableContainerRect.height / dialogRect.height
            ];
            const translate = [
              draggableContainerCenterCoordinates[0] - dialogCenterCoordinates[0],
              draggableContainerCenterCoordinates[1] - dialogCenterCoordinates[1]
            ];
            setSettingsOpenAnimationDetails({
              translate,
              scale,
              shouldStart: false,
              revert: false
            });
          });
        }
      }
      return () => {
        cancelled = true;
      };
    }, [isSettingsOpen, settingsOpenAnimationDetails, draggableContainerRef]);
    (0, import_react34.useEffect)(() => {
      let cancelled = false;
      if (settingsOpenAnimationDetails && !settingsOpenAnimationDetails.shouldStart) {
        requestAnimationFrame(() => {
          runAsynchronously(async () => {
            if (cancelled) return;
            setSettingsOpenAnimationDetails({ ...settingsOpenAnimationDetails, shouldStart: true });
          });
        });
      }
      return () => {
        cancelled = true;
      };
    }, [settingsOpenAnimationDetails]);
    const triggerEdit = (0, import_react34.useCallback)(() => {
      const settings = getSettings(props.widgetInstance);
      const widgetLabel = settings && typeof settings === "object" && "text" in settings && typeof settings.text === "string" ? settings.text : props.widgetInstance.widget.id;
      if (props.widgetInstance.widget.SettingsComponent) {
        setIsSettingsOpen(true);
      } else {
        window.dispatchEvent(new CustomEvent("widget-edit-request", {
          detail: { widgetId: props.widgetInstance.widget.id, widgetLabel }
        }));
      }
    }, [props.widgetInstance, setIsSettingsOpen]);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    return /* @__PURE__ */ jsxs(Fragment8, { children: [
      /* @__PURE__ */ jsx("style", { children: `
        /* note: Chrome and Safari have different behaviors when it comes to whether backface-visibility and/or transform-style is inherited by children, so we ensure it works with the style tag above + transformStyle */
        .stack-recursive-backface-hidden {
          backface-visibility: hidden;
          ${isSafari ? "" : "transform-style: preserve-3d;"}
        }
        .stack-recursive-backface-hidden * {
          backface-visibility: hidden;
        }
      ` }),
      /* @__PURE__ */ jsx(
        "div",
        {
          ref: setNodeRef,
          className: "stack-recursive-backface-hidden",
          onMouseEnter: () => {
            if (selectingForEdit) setIsHovered(true);
          },
          onMouseLeave: () => setIsHovered(false),
          style: {
            position: "relative",
            minWidth: "100%",
            minHeight: "100%",
            display: "flex",
            transformOrigin: "0 0 0",
            zIndex: isDragging ? 1e5 : 1,
            transition: [
              "border-width 0.1s ease",
              "box-shadow 0.1s ease",
              props.activeWidgetId !== props.widgetInstance.id && props.activeWidgetId !== null ? "transform 0.2s ease, opacity 0.2s ease" : void 0
            ].filter(Boolean).join(", "),
            ...filterUndefined(props.style ?? {}),
            transform: `translate3d(${transform?.x ?? 0}px, ${transform?.y ?? 0}px, 0) ${props.style?.transform ?? ""}`
          },
          children: /* @__PURE__ */ jsxs(
            "div",
            {
              className: cn(isDragging && "bg-white dark:bg-black border-black/20 dark:border-white/20"),
              style: {
                ...isFixedHeight ? {
                  position: "absolute",
                  inset: 0
                } : {
                  position: "relative",
                  width: "100%",
                  height: "100%"
                },
                overflow: props.isStatic ? "auto" : "hidden",
                flexGrow: 1,
                alignSelf: "stretch",
                boxShadow: isEditing ? "0 0 32px 0 #8882" : "0 0 0 0 transparent",
                cursor: isDragging ? "grabbing" : void 0,
                borderRadius: "8px",
                borderWidth: isEditing && !isDragging ? "1px" : "0px",
                borderStyle: "solid",
                transition: isDeleting ? `transform 0.3s ease, opacity 0.3s` : `transform 0.6s ease`,
                transform: [
                  settingsOpenAnimationDetails?.shouldStart && !settingsOpenAnimationDetails.revert ? `
                translate(${-settingsOpenAnimationDetails.translate[0]}px, ${-settingsOpenAnimationDetails.translate[1]}px)
                scale(${1 / settingsOpenAnimationDetails.scale[0]}, ${1 / settingsOpenAnimationDetails.scale[1]})
                rotateY(180deg)
              ` : "rotateY(0deg)",
                  isDeleting ? "scale(0.8)" : ""
                ].filter(Boolean).join(" "),
                opacity: isDeleting ? 0 : 1,
                display: "flex",
                flexDirection: "row"
              },
              children: [
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    "data-pacifica-children-flex-grow": true,
                    "data-pacifica-children-min-width-0": true,
                    style: {
                      flexGrow: 1,
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "flex-start"
                    },
                    children: /* @__PURE__ */ jsx("div", { style: { flexGrow: 1, minWidth: 0, width: "100%", height: "100%" }, children: /* @__PURE__ */ jsx(SwappableWidgetInstanceGridContext.Provider, { value: { isEditing: isEditingSubGrid }, children: /* @__PURE__ */ jsx(GridErrorBoundary, { fallback: (error, reset) => /* @__PURE__ */ jsxs("div", { className: "text-red-500 text-sm p-2 bg-red-500/10 font-mono whitespace-pre-wrap", children: [
                      "A runtime error occured while rendering this widget.",
                      /* @__PURE__ */ jsx("br", {}),
                      /* @__PURE__ */ jsx("br", {}),
                      reset && /* @__PURE__ */ jsx("button", { className: "text-blue-500 hover:underline", onClick: () => {
                        reset();
                      }, children: "Reload widget" }),
                      /* @__PURE__ */ jsx("br", {}),
                      /* @__PURE__ */ jsx("br", {}),
                      errorToString2(error)
                    ] }), children: /* @__PURE__ */ jsx(
                      props.widgetInstance.widget.MainComponent,
                      {
                        settings: getSettings(props.widgetInstance),
                        isSingleColumnMode: props.isSingleColumnMode,
                        state: props.stateRef.current,
                        stateRef: props.stateRef,
                        setState: (updater) => props.stateRef.set(updater(props.stateRef.current)),
                        widthInGridUnits: props.width,
                        heightInGridUnits: props.height
                      }
                    ) }) }) })
                  }
                ),
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    ...{ inert: "" },
                    style: {
                      position: "absolute",
                      inset: 0,
                      opacity: showOverlay || showHoverOverlay ? 1 : 0,
                      transition: "opacity 0.2s ease",
                      backgroundImage: !isDeleting ? "radial-gradient(circle at top, #ffffff08, #ffffff02), radial-gradient(circle at top right,  #ffffff04, transparent, transparent)" : void 0,
                      borderRadius: "inherit",
                      pointerEvents: "none"
                    }
                  }
                ),
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    ...{ inert: "" },
                    style: {
                      position: "absolute",
                      inset: 0,
                      backdropFilter: (showOverlay || showHoverOverlay) && !isDragging ? "blur(3px)" : "none",
                      borderRadius: "inherit",
                      pointerEvents: "none"
                    }
                  }
                ),
                selectingForEdit && /* @__PURE__ */ jsx(
                  "div",
                  {
                    onClick: () => triggerEdit(),
                    style: {
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      cursor: "pointer"
                    }
                  }
                ),
                !isDragging && isEditing && !selectingForEdit && /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      opacity: 1,
                      pointerEvents: "auto",
                      transition: "opacity 0.2s ease"
                    },
                    children: [
                      /* @__PURE__ */ jsx(
                        "div",
                        {
                          ...listeners,
                          ...attributes,
                          style: {
                            cursor: "move",
                            position: "absolute",
                            inset: 0,
                            touchAction: "none",
                            zIndex: 1
                          }
                        }
                      ),
                      props.widgetInstance.widget.hasSubGrid && /* @__PURE__ */ jsx("div", { style: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, pointerEvents: "none" }, children: /* @__PURE__ */ jsx(
                        BigIconButton2,
                        {
                          icon: /* @__PURE__ */ jsx(s2, { size: isCompact ? 16 : 24 }),
                          loadingStyle: "disabled",
                          style: { pointerEvents: "auto", ...isCompact ? { height: 48, width: 48 } : {} },
                          onClick: async () => {
                            setIsEditingSubGrid(true);
                          }
                        }
                      ) }),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          onClick: (e15) => {
                            e15.stopPropagation();
                            if (!confirmingDelete) {
                              setConfirmingDelete(true);
                              return;
                            }
                            runAsynchronouslyWithAlert(async () => {
                              setIsDeleting(true);
                              setConfirmingDelete(false);
                              try {
                                await wait(300);
                                await props.onDeleteWidget();
                              } catch (err) {
                                setIsDeleting(false);
                                throw err;
                              }
                            });
                          },
                          onMouseLeave: () => setConfirmingDelete(false),
                          style: {
                            position: "absolute",
                            top: 4,
                            right: 4,
                            zIndex: 101,
                            width: confirmingDelete ? "auto" : 20,
                            height: 20,
                            padding: confirmingDelete ? "0 6px" : void 0,
                            borderRadius: confirmingDelete ? "10px" : "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                            background: confirmingDelete ? "#ef4444" : "rgba(0,0,0,0.5)",
                            color: "white",
                            border: "none",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: "nowrap"
                          },
                          children: confirmingDelete ? /* @__PURE__ */ jsxs(Fragment8, { children: [
                            /* @__PURE__ */ jsx(n2, { size: 10, weight: "bold" }),
                            "Delete?"
                          ] }) : /* @__PURE__ */ jsx(n2, { size: 12, weight: "bold" })
                        }
                      ),
                      !props.isStatic && [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((y) => (x !== 0 || y !== 0) && /* @__PURE__ */ jsx(
                        ResizeHandle,
                        {
                          widgetInstance: props.widgetInstance,
                          x,
                          y,
                          onResize: (edges) => props.onResize(edges, draggableContainerRef.current?.getBoundingClientRect().height),
                          calculateUnitSize: props.calculateUnitSize
                        },
                        `${x},${y}`
                      ))),
                      props.resizeBlocked?.top && /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: {
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 3,
                            backgroundColor: "#ef4444",
                            borderRadius: "8px 8px 0 0",
                            pointerEvents: "none",
                            zIndex: 101
                          }
                        }
                      ),
                      props.resizeBlocked?.right && /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: {
                            position: "absolute",
                            top: 0,
                            right: 0,
                            bottom: 0,
                            width: 3,
                            backgroundColor: "#ef4444",
                            borderRadius: "0 8px 8px 0",
                            pointerEvents: "none",
                            zIndex: 101
                          }
                        }
                      ),
                      props.resizeBlocked?.left && /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: {
                            position: "absolute",
                            top: 0,
                            left: 0,
                            bottom: 0,
                            width: 3,
                            backgroundColor: "#ef4444",
                            borderRadius: "8px 0 0 8px",
                            pointerEvents: "none",
                            zIndex: 101
                          }
                        }
                      ),
                      props.resizeBlocked?.bottom && /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: {
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 3,
                            backgroundColor: "#ef4444",
                            borderRadius: "0 0 8px 8px",
                            pointerEvents: "none",
                            zIndex: 101
                          }
                        }
                      )
                    ]
                  }
                )
              ]
            }
          )
        }
      ),
      props.widgetInstance.widget.SettingsComponent && /* @__PURE__ */ jsx(Dialog2, { open: isSettingsOpen || settingsClosingAnimationCounter > 0, onOpenChange: setIsSettingsOpen, children: /* @__PURE__ */ jsxs(
        DialogContent2,
        {
          ref: dialogRef,
          overlayProps: {
            style: {
              opacity: settingsOpenAnimationDetails?.shouldStart && !settingsOpenAnimationDetails.revert ? 1 : 0,
              transition: `opacity 0.4s ease`,
              animation: "none"
            }
          },
          style: {
            transform: [
              "translate(-50%, -50%)",
              !settingsOpenAnimationDetails ? `` : settingsOpenAnimationDetails.shouldStart && !settingsOpenAnimationDetails.revert ? `rotateY(0deg)` : `
                    translate(${settingsOpenAnimationDetails.translate[0]}px, ${settingsOpenAnimationDetails.translate[1]}px)
                    scale(${settingsOpenAnimationDetails.scale[0]}, ${settingsOpenAnimationDetails.scale[1]})
                    rotateY(180deg)
                  `
            ].filter(Boolean).join(" "),
            transition: settingsOpenAnimationDetails?.shouldStart ? "transform 0.6s ease" : "none",
            visibility: settingsOpenAnimationDetails ? "visible" : "hidden",
            animation: "none"
          },
          ...isSettingsOpen ? {} : { inert: "" },
          onInteractOutside: (e15) => e15.preventDefault(),
          className: "[&>button]:hidden stack-recursive-backface-hidden",
          children: [
            /* @__PURE__ */ jsx(DialogHeader, { children: /* @__PURE__ */ jsx(DialogTitle2, { className: "flex items-center", children: "Edit Widget" }) }),
            /* @__PURE__ */ jsx(DialogBody, { className: "pb-2", children: /* @__PURE__ */ jsx(props.widgetInstance.widget.SettingsComponent, { settings: unsavedSettings, setSettings: setUnsavedSettings }) }),
            /* @__PURE__ */ jsxs(DialogFooter, { className: "gap-2", children: [
              /* @__PURE__ */ jsx(
                DesignButton,
                {
                  variant: "secondary",
                  onClick: async () => {
                    setIsSettingsOpen(false);
                  },
                  children: "Cancel"
                }
              ),
              /* @__PURE__ */ jsx(
                DesignButton,
                {
                  variant: "default",
                  onClick: async () => {
                    await props.setSettings(unsavedSettings);
                    setIsSettingsOpen(false);
                  },
                  children: "Save"
                }
              )
            ] })
          ]
        }
      ) })
    ] });
  }

  // src/components/grid-layout/heading-widget.tsx
  var sectionHeadingWidget = {
    id: "section-heading",
    MainComponent: ({ settings }) => {
      const Tag = settings.level ?? "h2";
      return /* @__PURE__ */ jsxs(Fragment8, { children: [
        /* @__PURE__ */ jsx("style", { children: `
          .section-heading-card {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            padding: 8px 12px 12px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 12px;
            box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.06);
          }
          .dark .section-heading-card {
            background: transparent;
            box-shadow: none;
          }
        ` }),
        /* @__PURE__ */ jsx("div", { className: "section-heading-card", children: /* @__PURE__ */ jsx(Tag, { style: {
          margin: 0,
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "hsl(var(--muted-foreground, 240 3.8% 46.1%))",
          width: "100%"
        }, children: settings.text }) })
      ] });
    },
    SettingsComponent: ({ settings, setSettings }) => {
      return /* @__PURE__ */ jsx("div", { style: { padding: "4px 0" }, children: /* @__PURE__ */ jsx(
        "input",
        {
          type: "text",
          value: settings.text,
          onChange: (e15) => {
            const newText = e15.target.value;
            setSettings((s4) => ({ ...s4, text: newText }));
          },
          style: {
            width: "100%",
            padding: "8px 12px",
            fontSize: "14px",
            border: "1px solid hsl(var(--border, 214.3 31.8% 91.4%))",
            borderRadius: "6px",
            background: "transparent",
            color: "inherit",
            outline: "none"
          },
          autoFocus: true,
          placeholder: "Section title..."
        }
      ) });
    },
    defaultSettings: { text: "Section", level: "h2" },
    defaultState: {},
    minHeight: 2
  };
  function createSectionHeadingInstance(text, level) {
    return {
      id: generateUuid(),
      widget: sectionHeadingWidget,
      settingsOrUndefined: { text, level: level ?? "h2" },
      stateOrUndefined: {}
    };
  }
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=dashboard-ui-components.global.js.map
