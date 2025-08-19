import { describe, expect, it } from 'vitest';
import { deindent } from '../../utils/strings';
import { transpileJsToSerializableJs } from './transpiler';

function getUserCode(str: string): string {
  const userCodeStartSentinel = "// USER_CODE_START\n";
  const userCodeEndSentinel = "// USER_CODE_END\n";
  return str.slice(str.indexOf(userCodeStartSentinel) + userCodeStartSentinel.length, str.indexOf(userCodeEndSentinel));
}

describe('transpileJsToSerializableJs', () => {
  describe('Arrow Functions', () => {
    it('should transform arrow functions without scope', () => {
      const input = deindent`
        () => {
          console.log('hello');
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        __STACK_SerializableJs.registerFunction(() => {
          console.log('hello');
        }, {
          scope: () => ({}),
          source: "()=>{console.log('hello');}"
        })"
      `);
    });

    it('should transform arrow functions in object fields called `scope`', () => {
      const input = deindent`
        const obj = {
          scope: () => ({}),
          fn: () => {
            console.log('hello');
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const obj = {
          scope: __STACK_SerializableJs.registerFunction(() => ({}), {
            scope: () => ({}),
            source: "()=>({})"
          }),
          fn: __STACK_SerializableJs.registerFunction(() => {
            console.log('hello');
          }, {
            scope: () => ({}),
            source: "()=>{console.log('hello');}"
          })
        }"
      `);
    });

    it('should transform arrow functions with scope', () => {
      const input = deindent`
        const x = 123;
        () => {
          console.log(x);
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 123;
        __STACK_SerializableJs.registerFunction(() => {
          console.log(x);
        }, {
          scope: () => ({
            x
          }),
          source: "()=>{console.log(__$getFromScope(\\"x\\"));}"
        })"
      `);
    });

    it('should transform recursive arrow functions', () => {
      const input = deindent`
        const fn = () => fn();
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const fn = __STACK_SerializableJs.registerFunction(() => fn(), {
          scope: () => ({
            fn
          }),
          source: "()=>__$getFromScope(\\"fn\\")()"
        })"
      `);
    });

    it('should transform recursive arrow functions that use a different name for the recursive call', () => {
      const input = deindent`
        const fn = () => b();
        const b = fn;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const fn = __STACK_SerializableJs.registerFunction(() => b(), {
          scope: () => ({
            b
          }),
          source: "()=>__$getFromScope(\\"b\\")()"
        });
        const b = fn"
      `);
    });

    it('should transform arrow functions with single expression', () => {
      const input = deindent`
        const x = 5;
        const fn = () => x * 2;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 5;
        const fn = __STACK_SerializableJs.registerFunction(() => x * 2, {
          scope: () => ({
            x
          }),
          source: "()=>__$getFromScope(\\"x\\")*2"
        })"
      `);
    });

    it('should transform arrow functions with single parameter without parens', () => {
      const input = deindent`
        const multiplier = 2;
        const fn = x => x * multiplier;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const multiplier = 2;
        const fn = __STACK_SerializableJs.registerFunction(x => x * multiplier, {
          scope: () => ({
            multiplier
          }),
          source: "x=>x*__$getFromScope(\\"multiplier\\")"
        })"
      `);
    });

    it('should transform arrow functions with multiple parameters', () => {
      const input = deindent`
        const offset = 10;
        const fn = (a, b) => a + b + offset;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const offset = 10;
        const fn = __STACK_SerializableJs.registerFunction((a, b) => a + b + offset, {
          scope: () => ({
            offset
          }),
          source: "(a,b)=>a+b+__$getFromScope(\\"offset\\")"
        })"
      `);
    });

    it('should transform arrow functions with more complicated dependencies', () => {
      const input = deindent`
        const store = {
          offset: 10
        };
        const fn = (a, b) => a + b + store.offset;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const store = {
          offset: 10
        };
        const fn = __STACK_SerializableJs.registerFunction((a, b) => a + b + store.offset, {
          scope: () => ({
            store
          }),
          source: "(a,b)=>a+b+__$getFromScope(\\"store\\").offset"
        })"
      `);
    });

    it('should transform async arrow functions', () => {
      const input = deindent`
        const url = 'api/data';
        const fn = async () => {
          return await fetch(url);
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const url = 'api/data';
        const fn = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime.mark(__STACK_SerializableJs.registerFunction(function _callee() {
            return _regeneratorRuntime.wrap(__STACK_SerializableJs.registerFunction(function (_context) {
              while (1) switch (_context.prev = _context.next) {
                case 0:
                  _context.next = 1;
                  return fetch(url);
                case 1:
                  return _context.abrupt("return", _context.sent);
                case 2:
                case "end":
                  return _context.stop();
              }
            }, {
              scope: () => ({
                url
              }),
              source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\"url\\"));case 1:return _context.abrupt(\\"return\\",_context.sent);case 2:case\\"end\\":return _context.stop();}})"
            }), _callee);
          }, {
            scope: () => ({
              _regeneratorRuntime,
              url
            }),
            source: "function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\"url\\"));case 1:return _context.abrupt(\\"return\\",_context.sent);case 2:case\\"end\\":return _context.stop();}},{scope:()=>({url:__$getFromScope(\\"url\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\\\\\"url\\\\\\"));case 1:return _context.abrupt(\\\\\\"return\\\\\\",_context.sent);case 2:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);}"
          })));
          return __STACK_SerializableJs.registerFunction(function fn() {
            return _ref.apply(this, arguments);
          }, {
            scope: () => ({
              _ref
            }),
            source: "function fn(){return __$getFromScope(\\"_ref\\").apply(this,arguments);}"
          });
        }, {
          scope: () => ({
            _asyncToGenerator,
            _regeneratorRuntime,
            url
          }),
          source: "(function(){var _ref=__$getFromScope(\\"_asyncToGenerator\\")(__$getFromScope(\\"_regeneratorRuntime\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\"url\\"));case 1:return _context.abrupt(\\"return\\",_context.sent);case 2:case\\"end\\":return _context.stop();}},{scope:()=>({url:__$getFromScope(\\"url\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\\\\\"url\\\\\\"));case 1:return _context.abrupt(\\\\\\"return\\\\\\",_context.sent);case 2:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),url:__$getFromScope(\\"url\\")}),source:\\"function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\\\\\"url\\\\\\"));case 1:return _context.abrupt(\\\\\\"return\\\\\\",_context.sent);case 2:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({url:__$getFromScope(\\\\\\"url\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\\\\\\\\\\\\\"url\\\\\\\\\\\\\\"));case 1:return _context.abrupt(\\\\\\\\\\\\\\"return\\\\\\\\\\\\\\",_context.sent);case 2:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);}\\"})));return __STACK_SerializableJs.registerFunction(function fn(){return _ref.apply(this,arguments);},{scope:()=>({_ref}),source:\\"function fn(){return __$getFromScope(\\\\\\"_ref\\\\\\").apply(this,arguments);}\\"});})"
        })()"
      `);
    });
  });

  describe('Function Expressions', () => {
    it('should transform anonymous function expressions', () => {
      const input = deindent`
        const y = 456;
        const fn = function() {
          return y * 2;
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const y = 456;
        const fn = __STACK_SerializableJs.registerFunction(function () {
          return y * 2;
        }, {
          scope: () => ({
            y
          }),
          source: "(function(){return __$getFromScope(\\"y\\")*2;})"
        })"
      `);
    });

    it('should transform named function expressions', () => {
      const input = deindent`
        const x = 10;
        const fn = function named() {
          return x;
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 10;
        const fn = __STACK_SerializableJs.registerFunction(function named() {
          return x;
        }, {
          scope: () => ({
            x
          }),
          source: "function named(){return __$getFromScope(\\"x\\");}"
        })"
      `);
    });

    it('should transform async function expressions', () => {
      const input = deindent`
        const delay = 1000;
        const fn = async function() {
          await new Promise(r => setTimeout(r, delay));
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const delay = 1000;
        const fn = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime.mark(__STACK_SerializableJs.registerFunction(function _callee() {
            return _regeneratorRuntime.wrap(__STACK_SerializableJs.registerFunction(function (_context) {
              while (1) switch (_context.prev = _context.next) {
                case 0:
                  _context.next = 1;
                  return new Promise(__STACK_SerializableJs.registerFunction(r => setTimeout(r, delay), {
                    scope: () => ({
                      delay
                    }),
                    source: "r=>setTimeout(r,__$getFromScope(\\"delay\\"))"
                  }));
                case 1:
                case "end":
                  return _context.stop();
              }
            }, {
              scope: () => ({
                delay
              }),
              source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return new Promise(__STACK_SerializableJs.registerFunction(r=>setTimeout(r,__$getFromScope(\\"delay\\")),{scope:()=>({delay:__$getFromScope(\\"delay\\")}),source:\\"r=>setTimeout(r,__$getFromScope(\\\\\\"delay\\\\\\"))\\"}));case 1:case\\"end\\":return _context.stop();}})"
            }), _callee);
          }, {
            scope: () => ({
              _regeneratorRuntime,
              delay
            }),
            source: "function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return new Promise(__STACK_SerializableJs.registerFunction(r=>setTimeout(r,__$getFromScope(\\"delay\\")),{scope:()=>({delay:__$getFromScope(\\"delay\\")}),source:\\"r=>setTimeout(r,__$getFromScope(\\\\\\"delay\\\\\\"))\\"}));case 1:case\\"end\\":return _context.stop();}},{scope:()=>({delay:__$getFromScope(\\"delay\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return new Promise(__STACK_SerializableJs.registerFunction(r=>setTimeout(r,__$getFromScope(\\\\\\"delay\\\\\\")),{scope:()=>({delay:__$getFromScope(\\\\\\"delay\\\\\\")}),source:\\\\\\"r=>setTimeout(r,__$getFromScope(\\\\\\\\\\\\\\"delay\\\\\\\\\\\\\\"))\\\\\\"}));case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);}"
          })));
          return __STACK_SerializableJs.registerFunction(function fn() {
            return _ref.apply(this, arguments);
          }, {
            scope: () => ({
              _ref
            }),
            source: "function fn(){return __$getFromScope(\\"_ref\\").apply(this,arguments);}"
          });
        }, {
          scope: () => ({
            _asyncToGenerator,
            _regeneratorRuntime,
            delay
          }),
          source: "(function(){var _ref=__$getFromScope(\\"_asyncToGenerator\\")(__$getFromScope(\\"_regeneratorRuntime\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return new Promise(__STACK_SerializableJs.registerFunction(r=>setTimeout(r,__$getFromScope(\\"delay\\")),{scope:()=>({delay:__$getFromScope(\\"delay\\")}),source:\\"r=>setTimeout(r,__$getFromScope(\\\\\\"delay\\\\\\"))\\"}));case 1:case\\"end\\":return _context.stop();}},{scope:()=>({delay:__$getFromScope(\\"delay\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return new Promise(__STACK_SerializableJs.registerFunction(r=>setTimeout(r,__$getFromScope(\\\\\\"delay\\\\\\")),{scope:()=>({delay:__$getFromScope(\\\\\\"delay\\\\\\")}),source:\\\\\\"r=>setTimeout(r,__$getFromScope(\\\\\\\\\\\\\\"delay\\\\\\\\\\\\\\"))\\\\\\"}));case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),delay:__$getFromScope(\\"delay\\")}),source:\\"function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return new Promise(__STACK_SerializableJs.registerFunction(r=>setTimeout(r,__$getFromScope(\\\\\\"delay\\\\\\")),{scope:()=>({delay:__$getFromScope(\\\\\\"delay\\\\\\")}),source:\\\\\\"r=>setTimeout(r,__$getFromScope(\\\\\\\\\\\\\\"delay\\\\\\\\\\\\\\"))\\\\\\"}));case 1:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({delay:__$getFromScope(\\\\\\"delay\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return new Promise(__STACK_SerializableJs.registerFunction(r=>setTimeout(r,__$getFromScope(\\\\\\\\\\\\\\"delay\\\\\\\\\\\\\\")),{scope:()=>({delay:__$getFromScope(\\\\\\\\\\\\\\"delay\\\\\\\\\\\\\\")}),source:\\\\\\\\\\\\\\"r=>setTimeout(r,__$getFromScope(\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"delay\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"))\\\\\\\\\\\\\\"}));case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);}\\"})));return __STACK_SerializableJs.registerFunction(function fn(){return _ref.apply(this,arguments);},{scope:()=>({_ref}),source:\\"function fn(){return __$getFromScope(\\\\\\"_ref\\\\\\").apply(this,arguments);}\\"});})"
        })()"
      `);
    });

    it('should transform generator function expressions', () => {
      const input = deindent`
        const max = 5;
        const gen = function*() {
          for (let i = 0; i < max; i++) yield i;
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const max = 5;
        const gen = /*#__PURE__*/_regeneratorRuntime.mark(__STACK_SerializableJs.registerFunction(function _callee() {
          var i;
          return _regeneratorRuntime.wrap(__STACK_SerializableJs.registerFunction(function (_context) {
            while (1) switch (_context.prev = _context.next) {
              case 0:
                i = 0;
              case 1:
                if (!(i < max)) {
                  _context.next = 3;
                  break;
                }
                _context.next = 2;
                return i;
              case 2:
                i++;
                _context.next = 1;
                break;
              case 3:
              case "end":
                return _context.stop();
            }
          }, {
            scope: () => ({
              i,
              max
            }),
            source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:i=0;case 1:if(!(__$getFromScope(\\"i\\")<__$getFromScope(\\"max\\"))){_context.next=3;break;}_context.next=2;return __$getFromScope(\\"i\\");case 2:__$getFromScope(\\"i\\")++;_context.next=1;break;case 3:case\\"end\\":return _context.stop();}})"
          }), _callee);
        }, {
          scope: () => ({
            _regeneratorRuntime,
            max
          }),
          source: "function _callee(){var i;return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:i=0;case 1:if(!(i<__$getFromScope(\\"max\\"))){_context.next=3;break;}_context.next=2;return i;case 2:i++;_context.next=1;break;case 3:case\\"end\\":return _context.stop();}},{scope:()=>({i,max:__$getFromScope(\\"max\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:i=0;case 1:if(!(__$getFromScope(\\\\\\"i\\\\\\")<__$getFromScope(\\\\\\"max\\\\\\"))){_context.next=3;break;}_context.next=2;return __$getFromScope(\\\\\\"i\\\\\\");case 2:__$getFromScope(\\\\\\"i\\\\\\")++;_context.next=1;break;case 3:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);}"
        }))"
      `);
    });

    it('should transform async generator function expressions', () => {
      const input = deindent`
        const data = [1, 2, 3];
        const gen = async function*() {
          for (const item of data) yield item;
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const data = [1, 2, 3];
        const gen = /*#__PURE__*/_regeneratorRuntime.mark(__STACK_SerializableJs.registerFunction(function _callee() {
          var _i, _data, item;
          return _regeneratorRuntime.async(__STACK_SerializableJs.registerFunction(function (_context) {
            while (1) switch (_context.prev = _context.next) {
              case 0:
                _i = 0, _data = data;
              case 1:
                if (!(_i < _data.length)) {
                  _context.next = 3;
                  break;
                }
                item = _data[_i];
                _context.next = 2;
                return item;
              case 2:
                _i++;
                _context.next = 1;
                break;
              case 3:
              case "end":
                return _context.stop();
            }
          }, {
            scope: () => ({
              data,
              _i,
              _data,
              item
            }),
            source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:_i=0,_data=__$getFromScope(\\"data\\");case 1:if(!(__$getFromScope(\\"_i\\")<__$getFromScope(\\"_data\\").length)){_context.next=3;break;}item=__$getFromScope(\\"_data\\")[__$getFromScope(\\"_i\\")];_context.next=2;return __$getFromScope(\\"item\\");case 2:__$getFromScope(\\"_i\\")++;_context.next=1;break;case 3:case\\"end\\":return _context.stop();}})"
          }), _callee, null, null, Promise);
        }, {
          scope: () => ({
            _regeneratorRuntime,
            data
          }),
          source: "function _callee(){var _i,_data,item;return __$getFromScope(\\"_regeneratorRuntime\\").async(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_i=0,_data=__$getFromScope(\\"data\\");case 1:if(!(_i<_data.length)){_context.next=3;break;}item=_data[_i];_context.next=2;return item;case 2:_i++;_context.next=1;break;case 3:case\\"end\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\"data\\"),_i,_data,item}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_i=0,_data=__$getFromScope(\\\\\\"data\\\\\\");case 1:if(!(__$getFromScope(\\\\\\"_i\\\\\\")<__$getFromScope(\\\\\\"_data\\\\\\").length)){_context.next=3;break;}item=__$getFromScope(\\\\\\"_data\\\\\\")[__$getFromScope(\\\\\\"_i\\\\\\")];_context.next=2;return __$getFromScope(\\\\\\"item\\\\\\");case 2:__$getFromScope(\\\\\\"_i\\\\\\")++;_context.next=1;break;case 3:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee,null,null,Promise);}"
        }))"
      `);
    });
  });

  describe('Function Declarations', () => {
    it('should transform function declarations', () => {
      const input = deindent`
        const data = 'test';
        function fetchData() {
          return data;
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const data = 'test';
        function fetchData() {
          return data;
        }
        __STACK_SerializableJs.registerFunction(fetchData, {
          scope: () => ({
            data
          }),
          source: "function fetchData(){return __$getFromScope(\\"data\\");}"
        })"
      `);
    });

    it('should transform function declarations that call each other in a circular dependency', () => {
      const input = deindent`
        function a() {
          return b();
        }
        function b() {
          return a();
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        function a() {
          return b();
        }
        __STACK_SerializableJs.registerFunction(a, {
          scope: () => ({
            b
          }),
          source: "function a(){return __$getFromScope(\\"b\\")();}"
        });
        function b() {
          return a();
        }
        __STACK_SerializableJs.registerFunction(b, {
          scope: () => ({
            a
          }),
          source: "function b(){return __$getFromScope(\\"a\\")();}"
        })"
      `);
    });

    it('should transform recursive function declarations', () => {
      const input = deindent`
        function a() {
          return a();
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        function a() {
          return a();
        }
        __STACK_SerializableJs.registerFunction(a, {
          scope: () => ({
            a
          }),
          source: "function a(){return __$getFromScope(\\"a\\")();}"
        })"
      `);
    });

    it('should transform async function declarations', () => {
      const input = deindent`
        const endpoint = '/api';
        async function fetchData() {
          return await fetch(endpoint);
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const endpoint = '/api';
        function fetchData() {
          return _fetchData.apply(this, arguments);
        }
        __STACK_SerializableJs.registerFunction(fetchData, {
          scope: () => ({
            _fetchData
          }),
          source: "function fetchData(){return __$getFromScope(\\"_fetchData\\").apply(this,arguments);}"
        });
        function _fetchData() {
          _fetchData = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime.mark(__STACK_SerializableJs.registerFunction(function _callee() {
            return _regeneratorRuntime.wrap(__STACK_SerializableJs.registerFunction(function (_context) {
              while (1) switch (_context.prev = _context.next) {
                case 0:
                  _context.next = 1;
                  return fetch(endpoint);
                case 1:
                  return _context.abrupt("return", _context.sent);
                case 2:
                case "end":
                  return _context.stop();
              }
            }, {
              scope: () => ({
                endpoint
              }),
              source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\"endpoint\\"));case 1:return _context.abrupt(\\"return\\",_context.sent);case 2:case\\"end\\":return _context.stop();}})"
            }), _callee);
          }, {
            scope: () => ({
              _regeneratorRuntime,
              endpoint
            }),
            source: "function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\"endpoint\\"));case 1:return _context.abrupt(\\"return\\",_context.sent);case 2:case\\"end\\":return _context.stop();}},{scope:()=>({endpoint:__$getFromScope(\\"endpoint\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\\\\\"endpoint\\\\\\"));case 1:return _context.abrupt(\\\\\\"return\\\\\\",_context.sent);case 2:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);}"
          })));
          return _fetchData.apply(this, arguments);
        }
        __STACK_SerializableJs.registerFunction(_fetchData, {
          scope: () => ({
            _asyncToGenerator,
            _regeneratorRuntime,
            endpoint,
            _fetchData
          }),
          source: "function _fetchData(){_fetchData=__$getFromScope(\\"_asyncToGenerator\\")(__$getFromScope(\\"_regeneratorRuntime\\").mark(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(function(_context){while(1)switch(_context.prev=_context.next){case 0:_context.next=1;return fetch(__$getFromScope(\\"endpoint\\"));case 1:return _context.abrupt(\\"return\\",_context.sent);case 2:case\\"end\\":return _context.stop();}},_callee);}));return __$getFromScope(\\"_fetchData\\").apply(this,arguments);}"
        })"
      `);
    });

    it('should transform generator function declarations', () => {
      const input = deindent`
        const items = [1, 2, 3];
        function* generator() {
          yield* items;
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        var _marked = /*#__PURE__*/_regeneratorRuntime.mark(generator);
        const items = [1, 2, 3];
        function generator() {
          return _regeneratorRuntime.wrap(__STACK_SerializableJs.registerFunction(function (_context) {
            while (1) switch (_context.prev = _context.next) {
              case 0:
                return _context.delegateYield(items, "t0", 1);
              case 1:
              case "end":
                return _context.stop();
            }
          }, {
            scope: () => ({
              items
            }),
            source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\"items\\"),\\"t0\\",1);case 1:case\\"end\\":return _context.stop();}})"
          }), _marked);
        }
        __STACK_SerializableJs.registerFunction(generator, {
          scope: () => ({
            _regeneratorRuntime,
            items,
            _marked
          }),
          source: "function generator(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\"items\\"),\\"t0\\",1);case 1:case\\"end\\":return _context.stop();}},__$getFromScope(\\"_marked\\"));}"
        })"
      `);
    });

    it('should transform async generator function declarations', () => {
      const input = deindent`
        const source = [1, 2, 3];
        async function* asyncGen() {
          for (const item of source) {
            yield await Promise.resolve(item);
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        var _marked = /*#__PURE__*/_regeneratorRuntime.mark(asyncGen);
        const source = [1, 2, 3];
        function asyncGen() {
          var _i, _source, item;
          return _regeneratorRuntime.async(__STACK_SerializableJs.registerFunction(function (_context) {
            while (1) switch (_context.prev = _context.next) {
              case 0:
                _i = 0, _source = source;
              case 1:
                if (!(_i < _source.length)) {
                  _context.next = 4;
                  break;
                }
                item = _source[_i];
                _context.next = 2;
                return _regeneratorRuntime.awrap(Promise.resolve(item));
              case 2:
                _context.next = 3;
                return _context.sent;
              case 3:
                _i++;
                _context.next = 1;
                break;
              case 4:
              case "end":
                return _context.stop();
            }
          }, {
            scope: () => ({
              source,
              _i,
              _source,
              _regeneratorRuntime,
              item
            }),
            source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:_i=0,_source=__$getFromScope(\\"source\\");case 1:if(!(__$getFromScope(\\"_i\\")<__$getFromScope(\\"_source\\").length)){_context.next=4;break;}item=__$getFromScope(\\"_source\\")[__$getFromScope(\\"_i\\")];_context.next=2;return __$getFromScope(\\"_regeneratorRuntime\\").awrap(Promise.resolve(__$getFromScope(\\"item\\")));case 2:_context.next=3;return _context.sent;case 3:__$getFromScope(\\"_i\\")++;_context.next=1;break;case 4:case\\"end\\":return _context.stop();}})"
          }), _marked, null, null, Promise);
        }
        __STACK_SerializableJs.registerFunction(asyncGen, {
          scope: () => ({
            _regeneratorRuntime,
            source,
            _marked
          }),
          source: "function asyncGen(){var _i,_source,item;return __$getFromScope(\\"_regeneratorRuntime\\").async(function(_context){while(1)switch(_context.prev=_context.next){case 0:_i=0,_source=__$getFromScope(\\"source\\");case 1:if(!(_i<_source.length)){_context.next=4;break;}item=_source[_i];_context.next=2;return __$getFromScope(\\"_regeneratorRuntime\\").awrap(Promise.resolve(item));case 2:_context.next=3;return _context.sent;case 3:_i++;_context.next=1;break;case 4:case\\"end\\":return _context.stop();}},__$getFromScope(\\"_marked\\"),null,null,Promise);}"
        })"
      `);
    });
  });

  describe('Object Methods', () => {
    it('should transform object method shorthand', () => {
      const input = deindent`
        const prefix = 'Hello';
        const obj = {
          greet() {
            return prefix + ' World';
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const prefix = 'Hello';
        const obj = {
          greet: __STACK_SerializableJs.registerFunction(function () {
            return prefix + ' World';
          }, {
            scope: () => ({
              prefix
            }),
            source: "(function(){return __$getFromScope(\\"prefix\\")+' World';})"
          })
        }"
      `);
    });

    it('should transform object method with key-value syntax', () => {
      const input = deindent`
        const x = 1;
        const obj = {
          method: function() { return x; }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 1;
        const obj = {
          method: __STACK_SerializableJs.registerFunction(function () {
            return x;
          }, {
            scope: () => ({
              x
            }),
            source: "(function(){return __$getFromScope(\\"x\\");})"
          })
        }"
      `);
    });

    it('should transform object method with arrow function', () => {
      const input = deindent`
        const x = 1;
        const obj = {
          method: () => x
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 1;
        const obj = {
          method: __STACK_SerializableJs.registerFunction(() => x, {
            scope: () => ({
              x
            }),
            source: "()=>__$getFromScope(\\"x\\")"
          })
        }"
      `);
    });

    it('should transform async object methods', () => {
      const input = deindent`
        const data = 'test';
        const obj = {
          async fetch() {
            return data;
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const data = 'test';
        const obj = {
          fetch: __STACK_SerializableJs.registerFunction(function () {
            return _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime.mark(function _callee() {
              return _regeneratorRuntime.wrap(function (_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    return _context.abrupt("return", data);
                  case 1:
                  case "end":
                    return _context.stop();
                }
              }, _callee);
            }))();
          }, {
            scope: () => ({
              _asyncToGenerator,
              _regeneratorRuntime,
              data
            }),
            source: "(function(){return __$getFromScope(\\"_asyncToGenerator\\")(__$getFromScope(\\"_regeneratorRuntime\\").mark(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\"return\\",__$getFromScope(\\"data\\"));case 1:case\\"end\\":return _context.stop();}},_callee);}))();})"
          })
        }"
      `);
    });

    it('should transform generator object methods', () => {
      const input = deindent`
        const max = 3;
        const obj = {
          *gen() {
            for (let i = 0; i < max; i++) yield i;
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const max = 3;
        const obj = {
          gen: __STACK_SerializableJs.registerFunction(function () {
            return /*#__PURE__*/_regeneratorRuntime.mark(function _callee() {
              var i;
              return _regeneratorRuntime.wrap(function (_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    i = 0;
                  case 1:
                    if (!(i < max)) {
                      _context.next = 3;
                      break;
                    }
                    _context.next = 2;
                    return i;
                  case 2:
                    i++;
                    _context.next = 1;
                    break;
                  case 3:
                  case "end":
                    return _context.stop();
                }
              }, _callee);
            })();
          }, {
            scope: () => ({
              _regeneratorRuntime,
              max
            }),
            source: "(function(){return __$getFromScope(\\"_regeneratorRuntime\\").mark(function _callee(){var i;return __$getFromScope(\\"_regeneratorRuntime\\").wrap(function(_context){while(1)switch(_context.prev=_context.next){case 0:i=0;case 1:if(!(i<__$getFromScope(\\"max\\"))){_context.next=3;break;}_context.next=2;return i;case 2:i++;_context.next=1;break;case 3:case\\"end\\":return _context.stop();}},_callee);})();})"
          })
        }"
      `);
    });

    it('should transform computed property methods', () => {
      const input = deindent`
        const key = 'method';
        const value = 42;
        const obj = {
          [key]() {
            return value;
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const key = 'method';
        const value = 42;
        const obj = {
          [key]: __STACK_SerializableJs.registerFunction(function () {
            return value;
          }, {
            scope: () => ({
              key,
              value
            }),
            source: "(function(){return __$getFromScope(\\"value\\");})"
          })
        }"
      `);
    });

    it('should transform getters', () => {
      const input = deindent`
        let value = 10;
        const obj = {
          get prop() {
            return value;
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        let value = 10;
        const obj = __STACK_SerializableJs.registerFunction(() => {
          const _obj = {};
          Object.defineProperty(_obj, "prop", {
            get: __STACK_SerializableJs.registerFunction(function () {
              return value;
            }, {
              scope: () => ({
                value
              }),
              source: "(function(){return __$getFromScope(\\"value\\");})"
            }),
            enumerable: true,
            configurable: true
          });
          return _obj;
        }, {
          scope: () => ({
            value
          }),
          source: "()=>{const _obj={};Object.defineProperty(_obj,\\"prop\\",{get:__STACK_SerializableJs.registerFunction(function(){return __$getFromScope(\\"value\\");},{scope:()=>({value:__$getFromScope(\\"value\\")}),source:\\"(function(){return __$getFromScope(\\\\\\"value\\\\\\");})\\"}),enumerable:true,configurable:true});return _obj;}"
        })()"
      `);
    });

    it('should transform setters', () => {
      const input = deindent`
        let value = 10;
        const obj = {
          set prop(v) {
            value = v;
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        let value = 10;
        const obj = __STACK_SerializableJs.registerFunction(() => {
          const _obj = {};
          Object.defineProperty(_obj, "prop", {
            set: __STACK_SerializableJs.registerFunction(function (v) {
              value = v;
            }, {
              scope: () => ({}),
              source: "(function(v){value=v;})"
            }),
            enumerable: true,
            configurable: true
          });
          return _obj;
        }, {
          scope: () => ({}),
          source: "()=>{const _obj={};Object.defineProperty(_obj,\\"prop\\",{set:__STACK_SerializableJs.registerFunction(function(v){value=v;},{scope:()=>({}),source:\\"(function(v){value=v;})\\"}),enumerable:true,configurable:true});return _obj;}"
        })()"
      `);
    });

    it('should transform both getters and setters', () => {
      const input = deindent`
        let value = 10;
        const obj = {
          get prop() {
            return value;
          },
          set prop(v) {
            value = v;
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        let value = 10;
        const obj = __STACK_SerializableJs.registerFunction(() => {
          const _obj = {};
          Object.defineProperty(_obj, "prop", {
            get: __STACK_SerializableJs.registerFunction(function () {
              return value;
            }, {
              scope: () => ({
                value
              }),
              source: "(function(){return __$getFromScope(\\"value\\");})"
            }),
            set: __STACK_SerializableJs.registerFunction(function (v) {
              value = v;
            }, {
              scope: () => ({}),
              source: "(function(v){value=v;})"
            }),
            enumerable: true,
            configurable: true
          });
          return _obj;
        }, {
          scope: () => ({
            value
          }),
          source: "()=>{const _obj={};Object.defineProperty(_obj,\\"prop\\",{get:__STACK_SerializableJs.registerFunction(function(){return __$getFromScope(\\"value\\");},{scope:()=>({value:__$getFromScope(\\"value\\")}),source:\\"(function(){return __$getFromScope(\\\\\\"value\\\\\\");})\\"}),set:__STACK_SerializableJs.registerFunction(function(v){value=v;},{scope:()=>({}),source:\\"(function(v){value=v;})\\"}),enumerable:true,configurable:true});return _obj;}"
        })()"
      `);
    });
  });

  describe('Class Methods', () => {
    it('should transform class methods', () => {
      const input = deindent`
        const classVar = 'test';
        class MyClass {
          method() {
            return classVar;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        const classVar = 'test';
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass() {
            _classCallCheck(this, MyClass);
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          return _createClass(MyClass, [{
            key: "method",
            value: __STACK_SerializableJs.registerFunction(function method() {
              return classVar;
            }, {
              scope: () => ({
                classVar
              }),
              source: "function method(){return __$getFromScope(\\"classVar\\");}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass,
            classVar
          }),
          source: "(function(){function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,[{key:\\"method\\",value:__STACK_SerializableJs.registerFunction(function method(){return __$getFromScope(\\"classVar\\");},{scope:()=>({classVar:__$getFromScope(\\"classVar\\")}),source:\\"function method(){return __$getFromScope(\\\\\\"classVar\\\\\\");}\\"})}]);})"
        })()"
      `);
    });

    it('should transform class arrow function properties', () => {
      const input = deindent`
        const x = 1;
        class MyClass {
          method = () => x;
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        const x = 1;
        let MyClass = /*#__PURE__*/_createClass(__STACK_SerializableJs.registerFunction(function MyClass() {
          _classCallCheck(this, MyClass);
          _defineProperty(this, "method", __STACK_SerializableJs.registerFunction(() => x, {
            scope: () => ({
              x
            }),
            source: "()=>__$getFromScope(\\"x\\")"
          }));
        }, {
          scope: () => ({
            _classCallCheck,
            _defineProperty,
            x
          }),
          source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);__$getFromScope(\\"_defineProperty\\")(this,\\"method\\",__STACK_SerializableJs.registerFunction(()=>__$getFromScope(\\"x\\"),{scope:()=>({x:__$getFromScope(\\"x\\")}),source:\\"()=>__$getFromScope(\\\\\\"x\\\\\\")\\"}));}"
        }))"
      `);
    });

    it('should transform static class methods', () => {
      const input = deindent`
        const staticVar = 'static';
        class MyClass {
          static staticMethod() {
            return staticVar;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        const staticVar = 'static';
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass() {
            _classCallCheck(this, MyClass);
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          return _createClass(MyClass, null, [{
            key: "staticMethod",
            value: __STACK_SerializableJs.registerFunction(function staticMethod() {
              return staticVar;
            }, {
              scope: () => ({
                staticVar
              }),
              source: "function staticMethod(){return __$getFromScope(\\"staticVar\\");}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass,
            staticVar
          }),
          source: "(function(){function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,null,[{key:\\"staticMethod\\",value:__STACK_SerializableJs.registerFunction(function staticMethod(){return __$getFromScope(\\"staticVar\\");},{scope:()=>({staticVar:__$getFromScope(\\"staticVar\\")}),source:\\"function staticMethod(){return __$getFromScope(\\\\\\"staticVar\\\\\\");}\\"})}]);})"
        })()"
      `);
    });

    it('should transform async class methods', () => {
      const input = deindent`
        const data = 'async data';
        class MyClass {
          async fetchData() {
            return data;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const data = 'async data';
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass() {
            _classCallCheck(this, MyClass);
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          return _createClass(MyClass, [{
            key: "fetchData",
            value: __STACK_SerializableJs.registerFunction(function fetchData() {
              return _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime.mark(__STACK_SerializableJs.registerFunction(function _callee() {
                return _regeneratorRuntime.wrap(__STACK_SerializableJs.registerFunction(function (_context) {
                  while (1) switch (_context.prev = _context.next) {
                    case 0:
                      return _context.abrupt("return", data);
                    case 1:
                    case "end":
                      return _context.stop();
                  }
                }, {
                  scope: () => ({
                    data
                  }),
                  source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\"return\\",__$getFromScope(\\"data\\"));case 1:case\\"end\\":return _context.stop();}})"
                }), _callee);
              }, {
                scope: () => ({
                  _regeneratorRuntime,
                  data
                }),
                source: "function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\"return\\",__$getFromScope(\\"data\\"));case 1:case\\"end\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\"data\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\"return\\\\\\",__$getFromScope(\\\\\\"data\\\\\\"));case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);}"
              })))();
            }, {
              scope: () => ({
                _asyncToGenerator,
                _regeneratorRuntime,
                data
              }),
              source: "function fetchData(){return __$getFromScope(\\"_asyncToGenerator\\")(__$getFromScope(\\"_regeneratorRuntime\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\"return\\",__$getFromScope(\\"data\\"));case 1:case\\"end\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\"data\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\"return\\\\\\",__$getFromScope(\\\\\\"data\\\\\\"));case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),data:__$getFromScope(\\"data\\")}),source:\\"function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\"return\\\\\\",__$getFromScope(\\\\\\"data\\\\\\"));case 1:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\\\\\"data\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\\\\\\\\\"return\\\\\\\\\\\\\\",__$getFromScope(\\\\\\\\\\\\\\"data\\\\\\\\\\\\\\"));case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);}\\"})))();}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass,
            _asyncToGenerator,
            _regeneratorRuntime,
            data
          }),
          source: "(function(){function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,[{key:\\"fetchData\\",value:__STACK_SerializableJs.registerFunction(function fetchData(){return __$getFromScope(\\"_asyncToGenerator\\")(__$getFromScope(\\"_regeneratorRuntime\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\"return\\",__$getFromScope(\\"data\\"));case 1:case\\"end\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\"data\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\"return\\\\\\",__$getFromScope(\\\\\\"data\\\\\\"));case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),data:__$getFromScope(\\"data\\")}),source:\\"function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\"return\\\\\\",__$getFromScope(\\\\\\"data\\\\\\"));case 1:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\\\\\"data\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\\\\\\\\\"return\\\\\\\\\\\\\\",__$getFromScope(\\\\\\\\\\\\\\"data\\\\\\\\\\\\\\"));case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);}\\"})))();},{scope:()=>({_asyncToGenerator:__$getFromScope(\\"_asyncToGenerator\\"),_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),data:__$getFromScope(\\"data\\")}),source:\\"function fetchData(){return __$getFromScope(\\\\\\"_asyncToGenerator\\\\\\")(__$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\"return\\\\\\",__$getFromScope(\\\\\\"data\\\\\\"));case 1:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\\\\\"data\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\\\\\\\\\"return\\\\\\\\\\\\\\",__$getFromScope(\\\\\\\\\\\\\\"data\\\\\\\\\\\\\\"));case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\"),data:__$getFromScope(\\\\\\"data\\\\\\")}),source:\\\\\\"function _callee(){return __$getFromScope(\\\\\\\\\\\\\\"_regeneratorRuntime\\\\\\\\\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\\\\\\\\\"return\\\\\\\\\\\\\\",__$getFromScope(\\\\\\\\\\\\\\"data\\\\\\\\\\\\\\"));case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}},{scope:()=>({data:__$getFromScope(\\\\\\\\\\\\\\"data\\\\\\\\\\\\\\")}),source:\\\\\\\\\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.abrupt(\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"return\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\",__$getFromScope(\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"data\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"));case 1:case\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\\\\\\\\\"}),_callee);}\\\\\\"})))();}\\"})}]);})"
        })()"
      `);
    });

    it('should transform generator class methods', () => {
      const input = deindent`
        const items = [1, 2, 3];
        class MyClass {
          *generator() {
            yield* items;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const items = [1, 2, 3];
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass() {
            _classCallCheck(this, MyClass);
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          return _createClass(MyClass, [{
            key: "generator",
            value: __STACK_SerializableJs.registerFunction(function generator() {
              return /*#__PURE__*/_regeneratorRuntime.mark(__STACK_SerializableJs.registerFunction(function _callee() {
                return _regeneratorRuntime.wrap(__STACK_SerializableJs.registerFunction(function (_context) {
                  while (1) switch (_context.prev = _context.next) {
                    case 0:
                      return _context.delegateYield(items, "t0", 1);
                    case 1:
                    case "end":
                      return _context.stop();
                  }
                }, {
                  scope: () => ({
                    items
                  }),
                  source: "(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\"items\\"),\\"t0\\",1);case 1:case\\"end\\":return _context.stop();}})"
                }), _callee);
              }, {
                scope: () => ({
                  _regeneratorRuntime,
                  items
                }),
                source: "function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\"items\\"),\\"t0\\",1);case 1:case\\"end\\":return _context.stop();}},{scope:()=>({items:__$getFromScope(\\"items\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\"items\\\\\\"),\\\\\\"t0\\\\\\",1);case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);}"
              }))();
            }, {
              scope: () => ({
                _regeneratorRuntime,
                items
              }),
              source: "function generator(){return __$getFromScope(\\"_regeneratorRuntime\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\"items\\"),\\"t0\\",1);case 1:case\\"end\\":return _context.stop();}},{scope:()=>({items:__$getFromScope(\\"items\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\"items\\\\\\"),\\\\\\"t0\\\\\\",1);case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),items:__$getFromScope(\\"items\\")}),source:\\"function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\"items\\\\\\"),\\\\\\"t0\\\\\\",1);case 1:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({items:__$getFromScope(\\\\\\"items\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\\\\\\\\\"items\\\\\\\\\\\\\\"),\\\\\\\\\\\\\\"t0\\\\\\\\\\\\\\",1);case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);}\\"}))();}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass,
            _regeneratorRuntime,
            items
          }),
          source: "(function(){function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,[{key:\\"generator\\",value:__STACK_SerializableJs.registerFunction(function generator(){return __$getFromScope(\\"_regeneratorRuntime\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\"_regeneratorRuntime\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\"items\\"),\\"t0\\",1);case 1:case\\"end\\":return _context.stop();}},{scope:()=>({items:__$getFromScope(\\"items\\")}),source:\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\"items\\\\\\"),\\\\\\"t0\\\\\\",1);case 1:case\\\\\\"end\\\\\\":return _context.stop();}})\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),items:__$getFromScope(\\"items\\")}),source:\\"function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\"items\\\\\\"),\\\\\\"t0\\\\\\",1);case 1:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({items:__$getFromScope(\\\\\\"items\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\\\\\\\\\"items\\\\\\\\\\\\\\"),\\\\\\\\\\\\\\"t0\\\\\\\\\\\\\\",1);case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);}\\"}))();},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\"),items:__$getFromScope(\\"items\\")}),source:\\"function generator(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").mark(__STACK_SerializableJs.registerFunction(function _callee(){return __$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\"items\\\\\\"),\\\\\\"t0\\\\\\",1);case 1:case\\\\\\"end\\\\\\":return _context.stop();}},{scope:()=>({items:__$getFromScope(\\\\\\"items\\\\\\")}),source:\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\\\\\\\\\"items\\\\\\\\\\\\\\"),\\\\\\\\\\\\\\"t0\\\\\\\\\\\\\\",1);case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\"}),_callee);},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\"),items:__$getFromScope(\\\\\\"items\\\\\\")}),source:\\\\\\"function _callee(){return __$getFromScope(\\\\\\\\\\\\\\"_regeneratorRuntime\\\\\\\\\\\\\\").wrap(__STACK_SerializableJs.registerFunction(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\\\\\\\\\"items\\\\\\\\\\\\\\"),\\\\\\\\\\\\\\"t0\\\\\\\\\\\\\\",1);case 1:case\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\":return _context.stop();}},{scope:()=>({items:__$getFromScope(\\\\\\\\\\\\\\"items\\\\\\\\\\\\\\")}),source:\\\\\\\\\\\\\\"(function(_context){while(1)switch(_context.prev=_context.next){case 0:return _context.delegateYield(__$getFromScope(\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"items\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"),\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"t0\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\",1);case 1:case\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\":return _context.stop();}})\\\\\\\\\\\\\\"}),_callee);}\\\\\\"}))();}\\"})}]);})"
        })()"
      `);
    });

    it('should transform class getters', () => {
      const input = deindent`
        const store = { value: 42 };
        class MyClass {
          get prop() {
            return store.value;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        const store = {
          value: 42
        };
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass() {
            _classCallCheck(this, MyClass);
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          return _createClass(MyClass, [{
            key: "prop",
            get: __STACK_SerializableJs.registerFunction(function () {
              return store.value;
            }, {
              scope: () => ({
                store
              }),
              source: "(function(){return __$getFromScope(\\"store\\").value;})"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass,
            store
          }),
          source: "(function(){function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,[{key:\\"prop\\",get:__STACK_SerializableJs.registerFunction(function(){return __$getFromScope(\\"store\\").value;},{scope:()=>({store:__$getFromScope(\\"store\\")}),source:\\"(function(){return __$getFromScope(\\\\\\"store\\\\\\").value;})\\"})}]);})"
        })()"
      `);
    });

    it('should transform class setters', () => {
      const input = deindent`
        let stored = 0;
        class MyClass {
          set prop(v) {
            stored = v;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        let stored = 0;
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass() {
            _classCallCheck(this, MyClass);
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));}"
          });
          return _createClass(MyClass, [{
            key: "prop",
            set: __STACK_SerializableJs.registerFunction(function (v) {
              stored = v;
            }, {
              scope: () => ({}),
              source: "(function(v){stored=v;})"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass
          }),
          source: "(function(){function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,[{key:\\"prop\\",set:__STACK_SerializableJs.registerFunction(function(v){stored=v;},{scope:()=>({}),source:\\"(function(v){stored=v;})\\"})}]);})"
        })()"
      `);
    });

    it('should transform private class methods', () => {
      const input = deindent`
        const secret = 'private';
        class MyClass {
          #privateMethod() {
            return secret;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_checkPrivateRedeclaration, {
          scope: () => ({}),
          source: "function _checkPrivateRedeclaration(e,t){if(t.has(e))throw new TypeError(\\"Cannot initialize the same private elements twice on an object\\");}"
        });
        const secret = 'private';
        var _MyClass_brand = /*#__PURE__*/new WeakSet();
        let MyClass = /*#__PURE__*/_createClass(__STACK_SerializableJs.registerFunction(function MyClass() {
          _classCallCheck(this, MyClass);
          _classPrivateMethodInitSpec(this, _MyClass_brand);
        }, {
          scope: () => ({
            _classCallCheck,
            _classPrivateMethodInitSpec,
            _MyClass_brand
          }),
          source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);__$getFromScope(\\"_classPrivateMethodInitSpec\\")(this,__$getFromScope(\\"_MyClass_brand\\"));}"
        }));
        function _privateMethod() {
          return secret;
        }
        __STACK_SerializableJs.registerFunction(_privateMethod, {
          scope: () => ({
            secret
          }),
          source: "function _privateMethod(){return __$getFromScope(\\"secret\\");}"
        })"
      `);
    });

    it('should handle constructors specially', () => {
      const input = deindent`
        const defaultValue = 100;
        class MyClass {
          constructor() {
            this.value = defaultValue;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_classCallCheck, {
          scope: () => ({}),
          source: "function _classCallCheck(a,n){if(!(a instanceof n))throw new TypeError(\\"Cannot call a class as a function\\");}"
        });
        const defaultValue = 100;
        let MyClass = /*#__PURE__*/_createClass(__STACK_SerializableJs.registerFunction(function MyClass() {
          _classCallCheck(this, MyClass);
          this.value = defaultValue;
        }, {
          scope: () => ({
            _classCallCheck,
            defaultValue
          }),
          source: "function MyClass(){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);this.value=__$getFromScope(\\"defaultValue\\");}"
        }))"
      `);
    });
  });

  describe('Functions as Arguments', () => {
    it('should transform functions passed as arguments', () => {
      const input = deindent`
        const x = 5;
        arr.map(item => item * x);
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 5;
        arr.map(__STACK_SerializableJs.registerFunction(item => item * x, {
          scope: () => ({
            x
          }),
          source: "item=>item*__$getFromScope(\\"x\\")"
        }))"
      `);
    });

    it('should transform functions in Promise chains', () => {
      const input = deindent`
        const multiplier = 2;
        promise.then(value => value * multiplier);
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const multiplier = 2;
        promise.then(__STACK_SerializableJs.registerFunction(value => value * multiplier, {
          scope: () => ({
            multiplier
          }),
          source: "value=>value*__$getFromScope(\\"multiplier\\")"
        }))"
      `);
    });

    it('should transform IIFEs (Immediately Invoked Function Expressions)', () => {
      const input = deindent`
        const x = 10;
        (function() {
          console.log(x);
        })();
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 10;
        __STACK_SerializableJs.registerFunction(function () {
          console.log(x);
        }, {
          scope: () => ({
            x
          }),
          source: "(function(){console.log(__$getFromScope(\\"x\\"));})"
        })()"
      `);
    });

    it('should transform IIFEs with arrow functions', () => {
      const input = deindent`
        const x = 10;
        (() => {
          console.log(x);
        })();
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 10;
        __STACK_SerializableJs.registerFunction(() => {
          console.log(x);
        }, {
          scope: () => ({
            x
          }),
          source: "()=>{console.log(__$getFromScope(\\"x\\"));}"
        })()"
      `);
    });
  });

  describe('Nested Functions', () => {
    it('should handle nested functions', () => {
      const input = deindent`
        const outer = 1;
        const fn = () => {
          const inner = 2;
          return () => {
            return outer + inner;
          };
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const outer = 1;
        const fn = __STACK_SerializableJs.registerFunction(() => {
          const inner = 2;
          return __STACK_SerializableJs.registerFunction(() => {
            return outer + inner;
          }, {
            scope: () => ({
              outer,
              inner
            }),
            source: "()=>{return __$getFromScope(\\"outer\\")+__$getFromScope(\\"inner\\");}"
          });
        }, {
          scope: () => ({
            outer
          }),
          source: "()=>{const inner=2;return __STACK_SerializableJs.registerFunction(()=>{return __$getFromScope(\\"outer\\")+inner;},{scope:()=>({outer:__$getFromScope(\\"outer\\"),inner}),source:\\"()=>{return __$getFromScope(\\\\\\"outer\\\\\\")+__$getFromScope(\\\\\\"inner\\\\\\");}\\"});}"
        })"
      `);
    });

    it('should handle deeply nested functions', () => {
      const input = deindent`
        const a = 1;
        const fn1 = () => {
          const b = 2;
          return () => {
            const c = 3;
            return () => a + b + c;
          };
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const a = 1;
        const fn1 = __STACK_SerializableJs.registerFunction(() => {
          const b = 2;
          return __STACK_SerializableJs.registerFunction(() => {
            const c = 3;
            return __STACK_SerializableJs.registerFunction(() => a + b + c, {
              scope: () => ({
                a,
                b,
                c
              }),
              source: "()=>__$getFromScope(\\"a\\")+__$getFromScope(\\"b\\")+__$getFromScope(\\"c\\")"
            });
          }, {
            scope: () => ({
              a,
              b
            }),
            source: "()=>{const c=3;return __STACK_SerializableJs.registerFunction(()=>__$getFromScope(\\"a\\")+__$getFromScope(\\"b\\")+c,{scope:()=>({a:__$getFromScope(\\"a\\"),b:__$getFromScope(\\"b\\"),c}),source:\\"()=>__$getFromScope(\\\\\\"a\\\\\\")+__$getFromScope(\\\\\\"b\\\\\\")+__$getFromScope(\\\\\\"c\\\\\\")\\"});}"
          });
        }, {
          scope: () => ({
            a
          }),
          source: "()=>{const b=2;return __STACK_SerializableJs.registerFunction(()=>{const c=3;return __STACK_SerializableJs.registerFunction(()=>__$getFromScope(\\"a\\")+b+c,{scope:()=>({a:__$getFromScope(\\"a\\"),b,c}),source:\\"()=>__$getFromScope(\\\\\\"a\\\\\\")+__$getFromScope(\\\\\\"b\\\\\\")+__$getFromScope(\\\\\\"c\\\\\\")\\"});},{scope:()=>({a:__$getFromScope(\\"a\\"),b}),source:\\"()=>{const c=3;return __STACK_SerializableJs.registerFunction(()=>__$getFromScope(\\\\\\"a\\\\\\")+__$getFromScope(\\\\\\"b\\\\\\")+c,{scope:()=>({a:__$getFromScope(\\\\\\"a\\\\\\"),b:__$getFromScope(\\\\\\"b\\\\\\"),c}),source:\\\\\\"()=>__$getFromScope(\\\\\\\\\\\\\\"a\\\\\\\\\\\\\\")+__$getFromScope(\\\\\\\\\\\\\\"b\\\\\\\\\\\\\\")+__$getFromScope(\\\\\\\\\\\\\\"c\\\\\\\\\\\\\\")\\\\\\"});}\\"});}"
        })"
      `);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty scope', () => {
      const input = deindent`
        () => {
          console.log('no external vars');
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        __STACK_SerializableJs.registerFunction(() => {
          console.log('no external vars');
        }, {
          scope: () => ({}),
          source: "()=>{console.log('no external vars');}"
        })"
      `);
    });

    it('should not capture function parameters in scope', () => {
      const input = deindent`
        const external = 5;
        const fn = (param) => {
          return param + external;
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const external = 5;
        const fn = __STACK_SerializableJs.registerFunction(param => {
          return param + external;
        }, {
          scope: () => ({
            external
          }),
          source: "param=>{return param+__$getFromScope(\\"external\\");}"
        })"
      `);
    });

    it('should handle destructured parameters', () => {
      const input = deindent`
        const multiplier = 2;
        const fn = ({x, y}) => (x + y) * multiplier;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const multiplier = 2;
        const fn = __STACK_SerializableJs.registerFunction(({
          x,
          y
        }) => (x + y) * multiplier, {
          scope: () => ({
            multiplier
          }),
          source: "({x,y})=>(x+y)*__$getFromScope(\\"multiplier\\")"
        })"
      `);
    });

    it('should handle rest parameters', () => {
      const input = deindent`
        const base = 10;
        const fn = (...args) => args.reduce((a, b) => a + b, base);
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const base = 10;
        const fn = __STACK_SerializableJs.registerFunction((...args) => args.reduce(__STACK_SerializableJs.registerFunction((a, b) => a + b, {
          scope: () => ({}),
          source: "(a,b)=>a+b"
        }), base), {
          scope: () => ({
            base
          }),
          source: "(...args)=>args.reduce(__STACK_SerializableJs.registerFunction((a,b)=>a+b,{scope:()=>({}),source:\\"(a,b)=>a+b\\"}),__$getFromScope(\\"base\\"))"
        })"
      `);
    });

    it('should handle default parameters', () => {
      const input = deindent`
        const defaultValue = 5;
        const fn = (x = defaultValue) => x * 2;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const defaultValue = 5;
        const fn = __STACK_SerializableJs.registerFunction((x = defaultValue) => x * 2, {
          scope: () => ({
            defaultValue
          }),
          source: "(x=__$getFromScope(\\"defaultValue\\"))=>x*2"
        })"
      `);
    });

    it('should handle functions returning functions', () => {
      const input = deindent`
        const x = 1;
        const factory = () => () => x;
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 1;
        const factory = __STACK_SerializableJs.registerFunction(() => __STACK_SerializableJs.registerFunction(() => x, {
          scope: () => ({
            x
          }),
          source: "()=>__$getFromScope(\\"x\\")"
        }), {
          scope: () => ({
            x
          }),
          source: "()=>__STACK_SerializableJs.registerFunction(()=>__$getFromScope(\\"x\\"),{scope:()=>({x:__$getFromScope(\\"x\\")}),source:\\"()=>__$getFromScope(\\\\\\"x\\\\\\")\\"})"
        })"
      `);
    });

    it('should preserve function body content', () => {
      const input = deindent`
        const x = 1;
        () => {
          const y = 2;
          return x + y;
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 1;
        __STACK_SerializableJs.registerFunction(() => {
          const y = 2;
          return x + y;
        }, {
          scope: () => ({
            x
          }),
          source: "()=>{const y=2;return __$getFromScope(\\"x\\")+y;}"
        })"
      `);
    });
  });

  describe('Expression Wrapping with ensureSerializable', () => {
    it('should wrap literal expressions when enabled', () => {
      const input = deindent`
        const x = 10;
        const y = "hello";
        const z = true;
        const arr = [1, 2, 3];
        const obj = { a: 1, b: 2 };
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = __STACK_SerializableJs.ensureSerializable(10);
        const y = __STACK_SerializableJs.ensureSerializable("hello");
        const z = __STACK_SerializableJs.ensureSerializable(true);
        const arr = __STACK_SerializableJs.ensureSerializable([__STACK_SerializableJs.ensureSerializable(1), __STACK_SerializableJs.ensureSerializable(2), __STACK_SerializableJs.ensureSerializable(3)]);
        const obj = __STACK_SerializableJs.ensureSerializable({
          a: __STACK_SerializableJs.ensureSerializable(1),
          b: __STACK_SerializableJs.ensureSerializable(2)
        })"
      `);
    });

    it('should wrap binary expressions', () => {
      const input = deindent`
        const a = 5;
        const b = 10;
        const sum = a + b;
        const product = a * b;
        const comparison = a > b;
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const a = __STACK_SerializableJs.ensureSerializable(5);
        const b = __STACK_SerializableJs.ensureSerializable(10);
        const sum = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) + __STACK_SerializableJs.ensureSerializable(b));
        const product = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) * __STACK_SerializableJs.ensureSerializable(b));
        const comparison = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) > __STACK_SerializableJs.ensureSerializable(b))"
      `);
    });

    it('should wrap member expressions', () => {
      const input = deindent`
        const obj = { a: { b: { c: 1 } } };
        const value = obj.a.b.c;
        const arr = [1, 2, 3];
        const elem = arr[1];
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const obj = __STACK_SerializableJs.ensureSerializable({
          a: __STACK_SerializableJs.ensureSerializable({
            b: __STACK_SerializableJs.ensureSerializable({
              c: __STACK_SerializableJs.ensureSerializable(1)
            })
          })
        });
        const value = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(obj).a).b).c);
        const arr = __STACK_SerializableJs.ensureSerializable([__STACK_SerializableJs.ensureSerializable(1), __STACK_SerializableJs.ensureSerializable(2), __STACK_SerializableJs.ensureSerializable(3)]);
        const elem = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(arr)[__STACK_SerializableJs.ensureSerializable(1)])"
      `);
    });

    it('should wrap call expressions', () => {
      const input = deindent`
        function add(a, b) {
          return a + b;
        }
        const result = add(5, 10);
        const chained = add(add(1, 2), 3);
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        function add(a, b) {
          return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) + __STACK_SerializableJs.ensureSerializable(b));
        }
        __STACK_SerializableJs.registerFunction(add, {
          scope: () => ({}),
          source: "function add(a,b){return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a)+__STACK_SerializableJs.ensureSerializable(b));}"
        });
        const result = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(add)(__STACK_SerializableJs.ensureSerializable(5), __STACK_SerializableJs.ensureSerializable(10)));
        const chained = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(add)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(add)(__STACK_SerializableJs.ensureSerializable(1), __STACK_SerializableJs.ensureSerializable(2))), __STACK_SerializableJs.ensureSerializable(3)))"
      `);
    });

    it('should not wrap update expressions', () => {
      const input = deindent`
        let count = 0;
        count++;
        count--;
        ++count;
        --count;
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        let count = __STACK_SerializableJs.ensureSerializable(0);
        count++;
        count--;
        ++count;
        --count"
      `);
    });

    it('should not wrap assignment left-hand sides', () => {
      const input = deindent`
        let x;
        x = 10;
        let obj = {};
        obj.prop = 20;
        obj['key'] = 30;
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        let x;
        x = __STACK_SerializableJs.ensureSerializable(10);
        let obj = __STACK_SerializableJs.ensureSerializable({});
        __STACK_SerializableJs.ensureSerializable(obj).prop = __STACK_SerializableJs.ensureSerializable(20);
        __STACK_SerializableJs.ensureSerializable(obj)[__STACK_SerializableJs.ensureSerializable('key')] = __STACK_SerializableJs.ensureSerializable(30)"
      `);
    });

    it('should wrap conditional expressions', () => {
      const input = deindent`
        const a = 5;
        const b = 10;
        const max = a > b ? a : b;
        const nested = a > 0 ? (b > 0 ? a + b : a) : 0;
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const a = __STACK_SerializableJs.ensureSerializable(5);
        const b = __STACK_SerializableJs.ensureSerializable(10);
        const max = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) > __STACK_SerializableJs.ensureSerializable(b)) ? __STACK_SerializableJs.ensureSerializable(a) : __STACK_SerializableJs.ensureSerializable(b));
        const nested = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) > __STACK_SerializableJs.ensureSerializable(0)) ? __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(b) > __STACK_SerializableJs.ensureSerializable(0)) ? __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) + __STACK_SerializableJs.ensureSerializable(b)) : __STACK_SerializableJs.ensureSerializable(a)) : __STACK_SerializableJs.ensureSerializable(0))"
      `);
    });

    it('should wrap function and class expressions with both ensureSerializable and register functions', () => {
      const input = deindent`
        const fn = function() { return 1; };
        const arrow = () => 2;
        const asyncFn = async () => 3;
        class MyClass {
          method() { return 4; }
        }
        const ClassExpr = class CE { };
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const fn = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function () {
          return __STACK_SerializableJs.ensureSerializable(1);
        }, {
          scope: () => ({}),
          source: "(function(){return __STACK_SerializableJs.ensureSerializable(1);})"
        }));
        const arrow = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(() => __STACK_SerializableJs.ensureSerializable(2), {
          scope: () => ({}),
          source: "()=>__STACK_SerializableJs.ensureSerializable(2)"
        }));
        const asyncFn = /*#__PURE__*/__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function () {
          var _ref = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_asyncToGenerator)(/*#__PURE__*/__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_regeneratorRuntime).mark)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function _callee() {
            return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_regeneratorRuntime).wrap)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function (_context) {
              while (__STACK_SerializableJs.ensureSerializable(1)) switch (__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))) {
                case __STACK_SerializableJs.ensureSerializable(0):
                  return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable("return"), __STACK_SerializableJs.ensureSerializable(3)));
                case __STACK_SerializableJs.ensureSerializable(1):
                case __STACK_SerializableJs.ensureSerializable("end"):
                  return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());
              }
            }, {
              scope: () => ({}),
              source: "(function(_context){while(__STACK_SerializableJs.ensureSerializable(1))switch(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))){case __STACK_SerializableJs.ensureSerializable(0):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable(\\"return\\"),__STACK_SerializableJs.ensureSerializable(3)));case __STACK_SerializableJs.ensureSerializable(1):case __STACK_SerializableJs.ensureSerializable(\\"end\\"):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());}})"
            })), __STACK_SerializableJs.ensureSerializable(_callee)));
          }, {
            scope: () => ({
              _regeneratorRuntime
            }),
            source: "function _callee(){return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_regeneratorRuntime\\")).wrap)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function(_context){while(__STACK_SerializableJs.ensureSerializable(1))switch(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))){case __STACK_SerializableJs.ensureSerializable(0):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable(\\"return\\"),__STACK_SerializableJs.ensureSerializable(3)));case __STACK_SerializableJs.ensureSerializable(1):case __STACK_SerializableJs.ensureSerializable(\\"end\\"):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());}},{scope:()=>({}),source:\\"(function(_context){while(__STACK_SerializableJs.ensureSerializable(1))switch(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))){case __STACK_SerializableJs.ensureSerializable(0):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable(\\\\\\"return\\\\\\"),__STACK_SerializableJs.ensureSerializable(3)));case __STACK_SerializableJs.ensureSerializable(1):case __STACK_SerializableJs.ensureSerializable(\\\\\\"end\\\\\\"):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());}})\\"})),__STACK_SerializableJs.ensureSerializable(_callee)));}"
          }))))));
          return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function asyncFn() {
            return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_ref).apply)(__STACK_SerializableJs.ensureSerializable(this), __STACK_SerializableJs.ensureSerializable(arguments)));
          }, {
            scope: () => ({
              _ref
            }),
            source: "function asyncFn(){return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_ref\\")).apply)(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(arguments)));}"
          }));
        }, {
          scope: () => ({
            _asyncToGenerator,
            _regeneratorRuntime
          }),
          source: "(function(){var _ref=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_asyncToGenerator\\"))(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_regeneratorRuntime\\")).mark)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function _callee(){return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_regeneratorRuntime\\")).wrap)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function(_context){while(__STACK_SerializableJs.ensureSerializable(1))switch(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))){case __STACK_SerializableJs.ensureSerializable(0):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable(\\"return\\"),__STACK_SerializableJs.ensureSerializable(3)));case __STACK_SerializableJs.ensureSerializable(1):case __STACK_SerializableJs.ensureSerializable(\\"end\\"):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());}},{scope:()=>({}),source:\\"(function(_context){while(__STACK_SerializableJs.ensureSerializable(1))switch(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))){case __STACK_SerializableJs.ensureSerializable(0):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable(\\\\\\"return\\\\\\"),__STACK_SerializableJs.ensureSerializable(3)));case __STACK_SerializableJs.ensureSerializable(1):case __STACK_SerializableJs.ensureSerializable(\\\\\\"end\\\\\\"):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());}})\\"})),__STACK_SerializableJs.ensureSerializable(_callee)));},{scope:()=>({_regeneratorRuntime:__$getFromScope(\\"_regeneratorRuntime\\")}),source:\\"function _callee(){return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\\\\\"_regeneratorRuntime\\\\\\")).wrap)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function(_context){while(__STACK_SerializableJs.ensureSerializable(1))switch(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))){case __STACK_SerializableJs.ensureSerializable(0):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable(\\\\\\"return\\\\\\"),__STACK_SerializableJs.ensureSerializable(3)));case __STACK_SerializableJs.ensureSerializable(1):case __STACK_SerializableJs.ensureSerializable(\\\\\\"end\\\\\\"):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());}},{scope:()=>({}),source:\\\\\\"(function(_context){while(__STACK_SerializableJs.ensureSerializable(1))switch(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).prev=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).next))){case __STACK_SerializableJs.ensureSerializable(0):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).abrupt)(__STACK_SerializableJs.ensureSerializable(\\\\\\\\\\\\\\"return\\\\\\\\\\\\\\"),__STACK_SerializableJs.ensureSerializable(3)));case __STACK_SerializableJs.ensureSerializable(1):case __STACK_SerializableJs.ensureSerializable(\\\\\\\\\\\\\\"end\\\\\\\\\\\\\\"):return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_context).stop)());}})\\\\\\"})),__STACK_SerializableJs.ensureSerializable(_callee)));}\\"}))))));return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function asyncFn(){return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_ref).apply)(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(arguments)));},{scope:()=>({_ref}),source:\\"function asyncFn(){return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\\\\\"_ref\\\\\\")).apply)(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(arguments)));}\\"}));})"
        }))());
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function () {
          function MyClass() {
            __STACK_SerializableJs.ensureSerializable(_classCallCheck)(__STACK_SerializableJs.ensureSerializable(this), __STACK_SerializableJs.ensureSerializable(MyClass));
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_classCallCheck\\"))(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"MyClass\\")));}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(){__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_classCallCheck\\"))(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"MyClass\\")));}"
          });
          return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_createClass)(__STACK_SerializableJs.ensureSerializable(MyClass), __STACK_SerializableJs.ensureSerializable([__STACK_SerializableJs.ensureSerializable({
            key: __STACK_SerializableJs.ensureSerializable("method"),
            value: __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function method() {
              return __STACK_SerializableJs.ensureSerializable(4);
            }, {
              scope: () => ({}),
              source: "function method(){return __STACK_SerializableJs.ensureSerializable(4);}"
            }))
          })])));
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass
          }),
          source: "(function(){function MyClass(){__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_classCallCheck\\"))(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(MyClass));}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(){__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\\\\\"_classCallCheck\\\\\\"))(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\\\\\"MyClass\\\\\\")));}\\"});return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_createClass\\"))(__STACK_SerializableJs.ensureSerializable(MyClass),__STACK_SerializableJs.ensureSerializable([__STACK_SerializableJs.ensureSerializable({key:__STACK_SerializableJs.ensureSerializable(\\"method\\"),value:__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function method(){return __STACK_SerializableJs.ensureSerializable(4);},{scope:()=>({}),source:\\"function method(){return __STACK_SerializableJs.ensureSerializable(4);}\\"}))})])));})"
        }))());
        const ClassExpr = /*#__PURE__*/__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_createClass)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function CE() {
          __STACK_SerializableJs.ensureSerializable(_classCallCheck)(__STACK_SerializableJs.ensureSerializable(this), __STACK_SerializableJs.ensureSerializable(CE));
        }, {
          scope: () => ({
            _classCallCheck
          }),
          source: "function CE(){__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_classCallCheck\\"))(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(CE));}"
        }))))"
      `);
    });

    it('should not wrap function and class declarations (statements)', () => {
      const input = deindent`
        function myFunction() { return 1; }
        class MyClass { }
        const x = 10;
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_classCallCheck, {
          scope: () => ({}),
          source: "function _classCallCheck(a,n){if(__STACK_SerializableJs.ensureSerializable(!__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a)instanceof __STACK_SerializableJs.ensureSerializable(n))))throw __STACK_SerializableJs.ensureSerializable(new(__STACK_SerializableJs.ensureSerializable(TypeError))(__STACK_SerializableJs.ensureSerializable(\\"Cannot call a class as a function\\")));}"
        });
        function myFunction() {
          return __STACK_SerializableJs.ensureSerializable(1);
        }
        __STACK_SerializableJs.registerFunction(myFunction, {
          scope: () => ({}),
          source: "function myFunction(){return __STACK_SerializableJs.ensureSerializable(1);}"
        });
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(_createClass)(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.registerFunction(function MyClass() {
          __STACK_SerializableJs.ensureSerializable(_classCallCheck)(__STACK_SerializableJs.ensureSerializable(this), __STACK_SerializableJs.ensureSerializable(MyClass));
        }, {
          scope: () => ({
            _classCallCheck
          }),
          source: "function MyClass(){__STACK_SerializableJs.ensureSerializable(__$getFromScope(\\"_classCallCheck\\"))(__STACK_SerializableJs.ensureSerializable(this),__STACK_SerializableJs.ensureSerializable(MyClass));}"
        }))));
        const x = __STACK_SerializableJs.ensureSerializable(10)"
      `);
    });

    it('should wrap expressions inside functions', () => {
      const input = deindent`
        const x = 10;
        function calculate(a, b) {
          const sum = a + b;
          const product = a * b;
          return sum > product ? sum : product;
        }
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: true });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = __STACK_SerializableJs.ensureSerializable(10);
        function calculate(a, b) {
          const sum = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) + __STACK_SerializableJs.ensureSerializable(b));
          const product = __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a) * __STACK_SerializableJs.ensureSerializable(b));
          return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(sum) > __STACK_SerializableJs.ensureSerializable(product)) ? __STACK_SerializableJs.ensureSerializable(sum) : __STACK_SerializableJs.ensureSerializable(product));
        }
        __STACK_SerializableJs.registerFunction(calculate, {
          scope: () => ({}),
          source: "function calculate(a,b){const sum=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a)+__STACK_SerializableJs.ensureSerializable(b));const product=__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(a)*__STACK_SerializableJs.ensureSerializable(b));return __STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(__STACK_SerializableJs.ensureSerializable(sum)>__STACK_SerializableJs.ensureSerializable(product))?__STACK_SerializableJs.ensureSerializable(sum):__STACK_SerializableJs.ensureSerializable(product));}"
        })"
      `);
    });

    it('should not wrap expressions when option is disabled', () => {
      const input = deindent`
        const x = 10;
        const y = x + 5;
        const obj = { a: 1 };
        const fn = () => x;
      `;

      const output = transpileJsToSerializableJs(input, { wrapExpressions: false });
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "
        const x = 10;
        const y = x + 5;
        const obj = {
          a: 1
        };
        const fn = __STACK_SerializableJs.registerFunction(() => x, {
          scope: () => ({
            x
          }),
          source: "()=>__$getFromScope(\\"x\\")"
        })"
      `);
    });

    it('should not wrap expressions by default', () => {
      const input = deindent`
        const x = 10;
        const y = x + 5;
      `;

      const outputDefault = transpileJsToSerializableJs(input);
      const outputExplicitFalse = transpileJsToSerializableJs(input, { wrapExpressions: false });

      expect(getUserCode(outputDefault)).toBe(getUserCode(outputExplicitFalse));
      expect(getUserCode(outputDefault)).not.toContain('ensureSerializable');
    });
  });

  describe('Class Transformation', () => {
    it('should transform simple class to constructor function', () => {
      const input = deindent`
        class MyClass {
          constructor(value) {
            this.value = value;
          }
          
          getValue() {
            return this.value;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        let MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass(value) {
            _classCallCheck(this, MyClass);
            this.value = value;
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(value){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));this.value=value;}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(value){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));this.value=value;}"
          });
          return _createClass(MyClass, [{
            key: "getValue",
            value: __STACK_SerializableJs.registerFunction(function getValue() {
              return this.value;
            }, {
              scope: () => ({}),
              source: "function getValue(){return this.value;}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass
          }),
          source: "(function(){function MyClass(value){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);this.value=value;}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(value){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));this.value=value;}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,[{key:\\"getValue\\",value:__STACK_SerializableJs.registerFunction(function getValue(){return this.value;},{scope:()=>({}),source:\\"function getValue(){return this.value;}\\"})}]);})"
        })()"
      `);
    });

    it('should handle class with static methods and properties', () => {
      const input = deindent`
        class Calculator {
          static PI = 3.14159;
          
          static add(a, b) {
            return a + b;
          }
          
          constructor(initial) {
            this.value = initial;
          }
          
          multiply(x) {
            this.value *= x;
            return this;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        let Calculator = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function Calculator(initial) {
            _classCallCheck(this, Calculator);
            this.value = initial;
          }
          __STACK_SerializableJs.registerFunction(Calculator, {
            scope: () => ({
              _classCallCheck,
              Calculator
            }),
            source: "function Calculator(initial){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Calculator\\"));this.value=initial;}"
          });
          __STACK_SerializableJs.registerFunction(Calculator, {
            scope: () => ({
              _classCallCheck,
              Calculator
            }),
            source: "function Calculator(initial){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Calculator\\"));this.value=initial;}"
          });
          return _createClass(Calculator, [{
            key: "multiply",
            value: __STACK_SerializableJs.registerFunction(function multiply(x) {
              this.value *= x;
              return this;
            }, {
              scope: () => ({}),
              source: "function multiply(x){this.value*=x;return this;}"
            })
          }], [{
            key: "add",
            value: __STACK_SerializableJs.registerFunction(function add(a, b) {
              return a + b;
            }, {
              scope: () => ({}),
              source: "function add(a,b){return a+b;}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass
          }),
          source: "(function(){function Calculator(initial){__$getFromScope(\\"_classCallCheck\\")(this,Calculator);this.value=initial;}__STACK_SerializableJs.registerFunction(Calculator,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),Calculator}),source:\\"function Calculator(initial){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"Calculator\\\\\\"));this.value=initial;}\\"});return __$getFromScope(\\"_createClass\\")(Calculator,[{key:\\"multiply\\",value:__STACK_SerializableJs.registerFunction(function multiply(x){this.value*=x;return this;},{scope:()=>({}),source:\\"function multiply(x){this.value*=x;return this;}\\"})}],[{key:\\"add\\",value:__STACK_SerializableJs.registerFunction(function add(a,b){return a+b;},{scope:()=>({}),source:\\"function add(a,b){return a+b;}\\"})}]);})"
        })();
        _defineProperty(Calculator, "PI", 3.14159)"
      `);
    });

    it('should handle class with private fields', () => {
      const input = deindent`
        class Counter {
          #count = 0;
          
          increment() {
            this.#count++;
          }
          
          getCount() {
            return this.#count;
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "let Counter = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function Counter() {
            _classCallCheck(this, Counter);
            _classPrivateFieldInitSpec(this, _count, 0);
          }
          __STACK_SerializableJs.registerFunction(Counter, {
            scope: () => ({
              _classCallCheck,
              Counter,
              _classPrivateFieldInitSpec,
              _count
            }),
            source: "function Counter(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Counter\\"));__$getFromScope(\\"_classPrivateFieldInitSpec\\")(this,__$getFromScope(\\"_count\\"),0);}"
          });
          __STACK_SerializableJs.registerFunction(Counter, {
            scope: () => ({
              _classCallCheck,
              Counter,
              _classPrivateFieldInitSpec,
              _count
            }),
            source: "function Counter(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Counter\\"));__$getFromScope(\\"_classPrivateFieldInitSpec\\")(this,__$getFromScope(\\"_count\\"),0);}"
          });
          return _createClass(Counter, [{
            key: "increment",
            value: __STACK_SerializableJs.registerFunction(function increment() {
              var _this$count, _this$count2;
              _classPrivateFieldSet(_count, this, (_this$count = _classPrivateFieldGet(_count, this), _this$count2 = _this$count++, _this$count)), _this$count2;
            }, {
              scope: () => ({
                _classPrivateFieldSet,
                _count,
                _classPrivateFieldGet
              }),
              source: "function increment(){var _this$count,_this$count2;__$getFromScope(\\"_classPrivateFieldSet\\")(__$getFromScope(\\"_count\\"),this,(_this$count=__$getFromScope(\\"_classPrivateFieldGet\\")(__$getFromScope(\\"_count\\"),this),_this$count2=_this$count++,_this$count)),_this$count2;}"
            })
          }, {
            key: "getCount",
            value: __STACK_SerializableJs.registerFunction(function getCount() {
              return _classPrivateFieldGet(_count, this);
            }, {
              scope: () => ({
                _classPrivateFieldGet,
                _count
              }),
              source: "function getCount(){return __$getFromScope(\\"_classPrivateFieldGet\\")(__$getFromScope(\\"_count\\"),this);}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _classPrivateFieldInitSpec,
            _count,
            _createClass,
            _classPrivateFieldSet,
            _classPrivateFieldGet
          }),
          source: "(function(){function Counter(){__$getFromScope(\\"_classCallCheck\\")(this,Counter);__$getFromScope(\\"_classPrivateFieldInitSpec\\")(this,__$getFromScope(\\"_count\\"),0);}__STACK_SerializableJs.registerFunction(Counter,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),Counter,_classPrivateFieldInitSpec:__$getFromScope(\\"_classPrivateFieldInitSpec\\"),_count:__$getFromScope(\\"_count\\")}),source:\\"function Counter(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"Counter\\\\\\"));__$getFromScope(\\\\\\"_classPrivateFieldInitSpec\\\\\\")(this,__$getFromScope(\\\\\\"_count\\\\\\"),0);}\\"});return __$getFromScope(\\"_createClass\\")(Counter,[{key:\\"increment\\",value:__STACK_SerializableJs.registerFunction(function increment(){var _this$count,_this$count2;__$getFromScope(\\"_classPrivateFieldSet\\")(__$getFromScope(\\"_count\\"),this,(_this$count=__$getFromScope(\\"_classPrivateFieldGet\\")(__$getFromScope(\\"_count\\"),this),_this$count2=_this$count++,_this$count)),_this$count2;},{scope:()=>({_classPrivateFieldSet:__$getFromScope(\\"_classPrivateFieldSet\\"),_count:__$getFromScope(\\"_count\\"),_classPrivateFieldGet:__$getFromScope(\\"_classPrivateFieldGet\\")}),source:\\"function increment(){var _this$count,_this$count2;__$getFromScope(\\\\\\"_classPrivateFieldSet\\\\\\")(__$getFromScope(\\\\\\"_count\\\\\\"),this,(_this$count=__$getFromScope(\\\\\\"_classPrivateFieldGet\\\\\\")(__$getFromScope(\\\\\\"_count\\\\\\"),this),_this$count2=_this$count++,_this$count)),_this$count2;}\\"})},{key:\\"getCount\\",value:__STACK_SerializableJs.registerFunction(function getCount(){return __$getFromScope(\\"_classPrivateFieldGet\\")(__$getFromScope(\\"_count\\"),this);},{scope:()=>({_classPrivateFieldGet:__$getFromScope(\\"_classPrivateFieldGet\\"),_count:__$getFromScope(\\"_count\\")}),source:\\"function getCount(){return __$getFromScope(\\\\\\"_classPrivateFieldGet\\\\\\")(__$getFromScope(\\\\\\"_count\\\\\\"),this);}\\"})}]);})"
        })()"
      `);
    });

    it('should handle class inheritance with super', () => {
      const input = deindent`
        class Animal {
          constructor(name) {
            this.name = name;
          }
          
          speak() {
            return 'Some sound';
          }
        }
        
        class Dog extends Animal {
          constructor(name, breed) {
            super(name);
            this.breed = breed;
          }
          
          speak() {
            return super.speak() + ' - Woof!';
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        let Animal = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function Animal(name) {
            _classCallCheck(this, Animal);
            this.name = name;
          }
          __STACK_SerializableJs.registerFunction(Animal, {
            scope: () => ({
              _classCallCheck,
              Animal
            }),
            source: "function Animal(name){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Animal\\"));this.name=name;}"
          });
          __STACK_SerializableJs.registerFunction(Animal, {
            scope: () => ({
              _classCallCheck,
              Animal
            }),
            source: "function Animal(name){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Animal\\"));this.name=name;}"
          });
          return _createClass(Animal, [{
            key: "speak",
            value: __STACK_SerializableJs.registerFunction(function speak() {
              return 'Some sound';
            }, {
              scope: () => ({}),
              source: "function speak(){return'Some sound';}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass
          }),
          source: "(function(){function Animal(name){__$getFromScope(\\"_classCallCheck\\")(this,Animal);this.name=name;}__STACK_SerializableJs.registerFunction(Animal,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),Animal}),source:\\"function Animal(name){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"Animal\\\\\\"));this.name=name;}\\"});return __$getFromScope(\\"_createClass\\")(Animal,[{key:\\"speak\\",value:__STACK_SerializableJs.registerFunction(function speak(){return'Some sound';},{scope:()=>({}),source:\\"function speak(){return'Some sound';}\\"})}]);})"
        })();
        let Dog = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function (_Animal) {
          function Dog(name, breed) {
            var _this;
            _classCallCheck(this, Dog);
            _this = _callSuper(this, Dog, [name]);
            _this.breed = breed;
            return _this;
          }
          __STACK_SerializableJs.registerFunction(Dog, {
            scope: () => ({
              _classCallCheck,
              Dog,
              _callSuper
            }),
            source: "function Dog(name,breed){var _this;__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Dog\\"));_this=__$getFromScope(\\"_callSuper\\")(this,__$getFromScope(\\"Dog\\"),[name]);_this.breed=breed;return _this;}"
          });
          __STACK_SerializableJs.registerFunction(Dog, {
            scope: () => ({
              _classCallCheck,
              Dog,
              _callSuper
            }),
            source: "function Dog(name,breed){var _this;__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Dog\\"));_this=__$getFromScope(\\"_callSuper\\")(this,__$getFromScope(\\"Dog\\"),[name]);_this.breed=breed;return _this;}"
          });
          _inherits(Dog, _Animal);
          return _createClass(Dog, [{
            key: "speak",
            value: __STACK_SerializableJs.registerFunction(function speak() {
              return _superPropGet(Dog, "speak", this, 3)([]) + ' - Woof!';
            }, {
              scope: () => ({
                _superPropGet,
                Dog
              }),
              source: "function speak(){return __$getFromScope(\\"_superPropGet\\")(__$getFromScope(\\"Dog\\"),\\"speak\\",this,3)([])+' - Woof!';}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _callSuper,
            _inherits,
            _createClass,
            _superPropGet
          }),
          source: "(function(_Animal){function Dog(name,breed){var _this;__$getFromScope(\\"_classCallCheck\\")(this,Dog);_this=__$getFromScope(\\"_callSuper\\")(this,Dog,[name]);_this.breed=breed;return _this;}__STACK_SerializableJs.registerFunction(Dog,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),Dog,_callSuper:__$getFromScope(\\"_callSuper\\")}),source:\\"function Dog(name,breed){var _this;__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"Dog\\\\\\"));_this=__$getFromScope(\\\\\\"_callSuper\\\\\\")(this,__$getFromScope(\\\\\\"Dog\\\\\\"),[name]);_this.breed=breed;return _this;}\\"});__$getFromScope(\\"_inherits\\")(Dog,_Animal);return __$getFromScope(\\"_createClass\\")(Dog,[{key:\\"speak\\",value:__STACK_SerializableJs.registerFunction(function speak(){return __$getFromScope(\\"_superPropGet\\")(Dog,\\"speak\\",this,3)([])+' - Woof!';},{scope:()=>({_superPropGet:__$getFromScope(\\"_superPropGet\\"),Dog}),source:\\"function speak(){return __$getFromScope(\\\\\\"_superPropGet\\\\\\")(__$getFromScope(\\\\\\"Dog\\\\\\"),\\\\\\"speak\\\\\\",this,3)([])+' - Woof!';}\\"})}]);})"
        })(Animal)"
      `);
    });

    it('should handle class with getters and setters', () => {
      const input = deindent`
        class Person {
          constructor(firstName, lastName) {
            this.firstName = firstName;
            this.lastName = lastName;
          }
          
          get fullName() {
            return \`\${this.firstName} \${this.lastName}\`;
          }
          
          set fullName(value) {
            const parts = value.split(' ');
            this.firstName = parts[0];
            this.lastName = parts[1];
          }
          
          static get species() {
            return 'Homo sapiens';
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        let Person = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function Person(firstName, lastName) {
            _classCallCheck(this, Person);
            this.firstName = firstName;
            this.lastName = lastName;
          }
          __STACK_SerializableJs.registerFunction(Person, {
            scope: () => ({
              _classCallCheck,
              Person
            }),
            source: "function Person(firstName,lastName){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Person\\"));this.firstName=firstName;this.lastName=lastName;}"
          });
          __STACK_SerializableJs.registerFunction(Person, {
            scope: () => ({
              _classCallCheck,
              Person
            }),
            source: "function Person(firstName,lastName){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"Person\\"));this.firstName=firstName;this.lastName=lastName;}"
          });
          return _createClass(Person, [{
            key: "fullName",
            get: __STACK_SerializableJs.registerFunction(function () {
              return \`\${this.firstName} \${this.lastName}\`;
            }, {
              scope: () => ({}),
              source: "(function(){return\`\${this.firstName} \${this.lastName}\`;})"
            }),
            set: __STACK_SerializableJs.registerFunction(function (value) {
              const parts = value.split(' ');
              this.firstName = parts[0];
              this.lastName = parts[1];
            }, {
              scope: () => ({}),
              source: "(function(value){const parts=value.split(' ');this.firstName=parts[0];this.lastName=parts[1];})"
            })
          }], [{
            key: "species",
            get: __STACK_SerializableJs.registerFunction(function () {
              return 'Homo sapiens';
            }, {
              scope: () => ({}),
              source: "(function(){return'Homo sapiens';})"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass
          }),
          source: "(function(){function Person(firstName,lastName){__$getFromScope(\\"_classCallCheck\\")(this,Person);this.firstName=firstName;this.lastName=lastName;}__STACK_SerializableJs.registerFunction(Person,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),Person}),source:\\"function Person(firstName,lastName){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"Person\\\\\\"));this.firstName=firstName;this.lastName=lastName;}\\"});return __$getFromScope(\\"_createClass\\")(Person,[{key:\\"fullName\\",get:__STACK_SerializableJs.registerFunction(function(){return\`\${this.firstName} \${this.lastName}\`;},{scope:()=>({}),source:\\"(function(){return\`\${this.firstName} \${this.lastName}\`;})\\"}),set:__STACK_SerializableJs.registerFunction(function(value){const parts=value.split(' ');this.firstName=parts[0];this.lastName=parts[1];},{scope:()=>({}),source:\\"(function(value){const parts=value.split(' ');this.firstName=parts[0];this.lastName=parts[1];})\\"})}],[{key:\\"species\\",get:__STACK_SerializableJs.registerFunction(function(){return'Homo sapiens';},{scope:()=>({}),source:\\"(function(){return'Homo sapiens';})\\"})}]);})"
        })()"
      `);
    });

    it('should handle class expressions', () => {
      const input = deindent`
        const MyClass = class {
          constructor(value) {
            this.value = value;
          }
          
          getValue() {
            return this.value;
          }
        };
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "__STACK_SerializableJs.registerFunction(_toPrimitive, {
          scope: () => ({}),
          source: "function _toPrimitive(t,r){if(\\"object\\"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||\\"default\\");if(\\"object\\"!=typeof i)return i;throw new TypeError(\\"@@toPrimitive must return a primitive value.\\");}return(\\"string\\"===r?String:Number)(t);}"
        });
        const MyClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function MyClass(value) {
            _classCallCheck(this, MyClass);
            this.value = value;
          }
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(value){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));this.value=value;}"
          });
          __STACK_SerializableJs.registerFunction(MyClass, {
            scope: () => ({
              _classCallCheck,
              MyClass
            }),
            source: "function MyClass(value){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"MyClass\\"));this.value=value;}"
          });
          return _createClass(MyClass, [{
            key: "getValue",
            value: __STACK_SerializableJs.registerFunction(function getValue() {
              return this.value;
            }, {
              scope: () => ({}),
              source: "function getValue(){return this.value;}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _createClass
          }),
          source: "(function(){function MyClass(value){__$getFromScope(\\"_classCallCheck\\")(this,MyClass);this.value=value;}__STACK_SerializableJs.registerFunction(MyClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),MyClass}),source:\\"function MyClass(value){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"MyClass\\\\\\"));this.value=value;}\\"});return __$getFromScope(\\"_createClass\\")(MyClass,[{key:\\"getValue\\",value:__STACK_SerializableJs.registerFunction(function getValue(){return this.value;},{scope:()=>({}),source:\\"function getValue(){return this.value;}\\"})}]);})"
        })()"
      `);
    });

    it('should handle private methods', () => {
      const input = deindent`
        class SecureClass {
          #privateMethod() {
            return 'secret';
          }
          
          publicMethod() {
            return this.#privateMethod();
          }
        }
      `;

      const output = transpileJsToSerializableJs(input);
      expect(getUserCode(output)).toMatchInlineSnapshot(`
        "let SecureClass = /*#__PURE__*/__STACK_SerializableJs.registerFunction(function () {
          function SecureClass() {
            _classCallCheck(this, SecureClass);
            _classPrivateMethodInitSpec(this, _SecureClass_brand);
          }
          __STACK_SerializableJs.registerFunction(SecureClass, {
            scope: () => ({
              _classCallCheck,
              SecureClass,
              _classPrivateMethodInitSpec,
              _SecureClass_brand
            }),
            source: "function SecureClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"SecureClass\\"));__$getFromScope(\\"_classPrivateMethodInitSpec\\")(this,__$getFromScope(\\"_SecureClass_brand\\"));}"
          });
          __STACK_SerializableJs.registerFunction(SecureClass, {
            scope: () => ({
              _classCallCheck,
              SecureClass,
              _classPrivateMethodInitSpec,
              _SecureClass_brand
            }),
            source: "function SecureClass(){__$getFromScope(\\"_classCallCheck\\")(this,__$getFromScope(\\"SecureClass\\"));__$getFromScope(\\"_classPrivateMethodInitSpec\\")(this,__$getFromScope(\\"_SecureClass_brand\\"));}"
          });
          return _createClass(SecureClass, [{
            key: "publicMethod",
            value: __STACK_SerializableJs.registerFunction(function publicMethod() {
              return _assertClassBrand(_SecureClass_brand, this, _privateMethod).call(this);
            }, {
              scope: () => ({
                _assertClassBrand,
                _SecureClass_brand,
                _privateMethod
              }),
              source: "function publicMethod(){return __$getFromScope(\\"_assertClassBrand\\")(__$getFromScope(\\"_SecureClass_brand\\"),this,__$getFromScope(\\"_privateMethod\\")).call(this);}"
            })
          }]);
        }, {
          scope: () => ({
            _classCallCheck,
            _classPrivateMethodInitSpec,
            _SecureClass_brand,
            _createClass,
            _assertClassBrand,
            _privateMethod
          }),
          source: "(function(){function SecureClass(){__$getFromScope(\\"_classCallCheck\\")(this,SecureClass);__$getFromScope(\\"_classPrivateMethodInitSpec\\")(this,__$getFromScope(\\"_SecureClass_brand\\"));}__STACK_SerializableJs.registerFunction(SecureClass,{scope:()=>({_classCallCheck:__$getFromScope(\\"_classCallCheck\\"),SecureClass,_classPrivateMethodInitSpec:__$getFromScope(\\"_classPrivateMethodInitSpec\\"),_SecureClass_brand:__$getFromScope(\\"_SecureClass_brand\\")}),source:\\"function SecureClass(){__$getFromScope(\\\\\\"_classCallCheck\\\\\\")(this,__$getFromScope(\\\\\\"SecureClass\\\\\\"));__$getFromScope(\\\\\\"_classPrivateMethodInitSpec\\\\\\")(this,__$getFromScope(\\\\\\"_SecureClass_brand\\\\\\"));}\\"});return __$getFromScope(\\"_createClass\\")(SecureClass,[{key:\\"publicMethod\\",value:__STACK_SerializableJs.registerFunction(function publicMethod(){return __$getFromScope(\\"_assertClassBrand\\")(__$getFromScope(\\"_SecureClass_brand\\"),this,__$getFromScope(\\"_privateMethod\\")).call(this);},{scope:()=>({_assertClassBrand:__$getFromScope(\\"_assertClassBrand\\"),_SecureClass_brand:__$getFromScope(\\"_SecureClass_brand\\"),_privateMethod:__$getFromScope(\\"_privateMethod\\")}),source:\\"function publicMethod(){return __$getFromScope(\\\\\\"_assertClassBrand\\\\\\")(__$getFromScope(\\\\\\"_SecureClass_brand\\\\\\"),this,__$getFromScope(\\\\\\"_privateMethod\\\\\\")).call(this);}\\"})}]);})"
        })();
        function _privateMethod() {
          return 'secret';
        }
        __STACK_SerializableJs.registerFunction(_privateMethod, {
          scope: () => ({}),
          source: "function _privateMethod(){return'secret';}"
        })"
      `);
    });
  });
});
