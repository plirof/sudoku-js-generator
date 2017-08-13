'use strict';

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// Utility
var utils = function () {
  function dom(selector) {
    if (selector[0] === '#') {
      return document.getElementById(selector.slice(1));
    }
    return document.querySelectorAll(selector);
  }

  function copyJSON(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function isTouchDevice() {
    return navigator.userAgent.match(/(iPhone|iPod|iPad|Android|BlackBerry)/);
  }

  function getWorkerURLFromElement(selector) {
    var element = dom(selector);
    var content = babel.transform(element.innerText).code;
    var blob = new Blob([content], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
  }

  // Will be used for restoring caret positions on rerenders.
  // Taken from:
  // http://stackoverflow.com/questions/1125292/how-to-move-cursor-to-end-of-contenteditable-entity
  var cursorManager = function () {
    var cursorManager = {};

    var voidNodeTags = ['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'KEYGEN', 'LINK', 'MENUITEM', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR', 'BASEFONT', 'BGSOUND', 'FRAME', 'ISINDEX'];

    Array.prototype.contains = function (obj) {
      var i = this.length;
      while (i--) {
        if (this[i] === obj) {
          return true;
        }
      }
      return false;
    };

    function canContainText(node) {
      if (node.nodeType == 1) {
        return !voidNodeTags.contains(node.nodeName);
      } else {
        return false;
      }
    };

    function getLastChildElement(el) {
      var lc = el.lastChild;
      while (lc && lc.nodeType != 1) {
        if (lc.previousSibling) lc = lc.previousSibling;else break;
      }
      return lc;
    }
    cursorManager.setEndOfContenteditable = function (contentEditableElement) {

      while (getLastChildElement(contentEditableElement) && canContainText(getLastChildElement(contentEditableElement))) {
        contentEditableElement = getLastChildElement(contentEditableElement);
      }

      var range, selection;
      if (document.createRange) {
        range = document.createRange();
        range.selectNodeContents(contentEditableElement);
        range.collapse(false);
        selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } else if (document.selection) {
        range = document.body.createTextRange();
        range.moveToElementText(contentEditableElement);
        range.collapse(false);
        range.select();
      }
    };

    return cursorManager;
  }();

  return {
    copyJSON: copyJSON, cursorManager: cursorManager, dom: dom,
    getWorkerURLFromElement: getWorkerURLFromElement, isTouchDevice: isTouchDevice
  };
}();

// API Adapter

var SudokuAdapter = function () {
  function SudokuAdapter(url) {
    _classCallCheck(this, SudokuAdapter);

    this.worker = new Worker(url);
    return this;
  }

  SudokuAdapter.prototype._postMessage = function _postMessage(options) {
    var _this = this;

    this.worker.postMessage(JSON.stringify(options));
    return new Promise(function (resolve, reject) {
      _this.worker.onmessage = function (event) {
        resolve(event.data);
      };
    });
  };

  SudokuAdapter.prototype.generate = function generate(options) {
    options = Object.assign({}, options, { method: 'generate' });

    return this._postMessage(options);
  };

  SudokuAdapter.prototype.validate = function validate(options) {
    options = Object.assign({}, options, { method: 'validate' });

    return this._postMessage(options);
  };

  return SudokuAdapter;
}();

// Client Side Settings

var SUDOKU_APP_CONFIG = {
  HINTS: 34,
  TRY_LIMIT: 100000,
  WORKER_URL: utils.getWorkerURLFromElement('#worker'),
  DOM_TARGET: utils.dom('#sudoku-app')
};

// Client Side
var SudokuApp = function (config) {
  var HINTS = config.HINTS;
  var TRY_LIMIT = config.TRY_LIMIT;
  var WORKER_URL = config.WORKER_URL;
  var DOM_TARGET = config.DOM_TARGET;

  var sudokuAdapter = new SudokuAdapter(WORKER_URL);

  var state = {
    success: null,
    board: null,
    solution: null,
    solved: null,
    errors: []
  };
  Object.observe(state, render);

  var history = [state];
  var historyStash = [];

  // Event listeners
  var onClickGenerate = initialize;

  var onClickSolve = function onClickSolve() {
    setState({
      board: state.solution,
      solved: true,
      errors: []
    });
  };

  var onKeyUpCell = function onKeyUpCell(event) {
    var key = event.keyCode;
    if ( // a
    key === 36 || // r
    key === 37 || // r
    key === 38 || // o
    key === 39 || // w
    key === 9 || // tab
    // mod key flags are always false in keyup event
    // keyIdentifier doesn't seem to be implemented
    // in all browsers
    key === 17 || // Control
    key === 16 || // Shift
    key === 91 || // Meta
    key === 19 || // Alt
    event.keyIdentifier === 'Control' || event.keyIdentifier === 'Shift' || event.keyIdentifier === 'Meta' || event.keyIdentifier === 'Alt') return;

    var cell = event.target;
    var value = cell.innerText;

    if (value.length > 4) {
      cell.innerText = value.slice(0, 4);
      return false;
    }

    var cellIndex = cell.getAttribute('data-cell-index');
    cellIndex = parseInt(cellIndex, 10);
    var rowIndex = Math.floor(cellIndex / 9);
    var cellIndexInRow = cellIndex - rowIndex * 9;

    var board = Object.assign([], state.board);
    board[rowIndex].splice(cellIndexInRow, 1, value);

    validate(board).then(function (errors) {
      historyStash = [];
      history.push({});
      var solved = null;
      if (errors.indexOf(true) === -1) {
        solved = true;
        board.forEach(function (row) {
          row.forEach(function (value) {
            if (!value || !parseInt(value, 10) || value.length > 1) {
              solved = false;
            }
          });
        });
      }
      if (solved) {
        board = Object.assign([], board).map(function (row) {
          return row.map(function (n) {
            return +n;
          });
        });
      }
      setState({ board: board, errors: errors, solved: solved }, function (newState) {
        history[history.length - 1] = newState;
        restoreCaretPosition(cellIndex);
      });
    });
  };

  function keyDown(event) {
    var keys = {
      ctrlOrCmd: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      z: event.keyCode === 90
    };

    if (keys.ctrlOrCmd && keys.z) {
      if (keys.shift && historyStash.length) {
        redo();
      } else if (!keys.shift && history.length > 1) {
        undo();
      }
    }
  }

  function undo() {
    historyStash.push(history.pop());
    setState(utils.copyJSON(history[history.length - 1]));
  }

  function redo() {
    history.push(historyStash.pop());
    setState(utils.copyJSON(history[history.length - 1]));
  }

  function initialize() {
    unbindEvents();
    render();
    getSudoku().then(function (sudoku) {
      setState({
        success: sudoku.success,
        board: sudoku.board,
        solution: sudoku.solution,
        errors: [],
        solved: false
      }, function (newState) {
        history = [newState];
        historyStash = [];
      });
    });
  }

  function setState(newState, callback) {
    requestAnimationFrame(function () {
      Object.assign(state, newState);
      if (typeof callback === 'function') {
        var param = utils.copyJSON(state);
        requestAnimationFrame(callback.bind(null, param));
      }
    });
  }

  function bindEvents() {
    var generateButton = utils.dom('#generate-button');
    var solveButton = utils.dom('#solve-button');
    var undoButton = utils.dom('#undo-button');
    var redoButton = utils.dom('#redo-button');
    generateButton && generateButton.addEventListener('click', onClickGenerate);
    solveButton && solveButton.addEventListener('click', onClickSolve);
    undoButton && undoButton.addEventListener('click', undo);
    redoButton && redoButton.addEventListener('click', redo);

    var cells = utils.dom('.sudoku__table-cell');[].forEach.call(cells, function (cell) {
      cell.addEventListener('keyup', onKeyUpCell);
    });

    window.addEventListener('keydown', keyDown);
  }

  function unbindEvents() {
    var generateButton = utils.dom('#generate-button');
    var solveButton = utils.dom('#solve-button');
    var undoButton = utils.dom('#undo-button');
    var redoButton = utils.dom('#redo-button');
    generateButton && generateButton.removeEventListener('click', onClickGenerate);
    solveButton && solveButton.removeEventListener('click', onClickSolve);
    undoButton && undoButton.removeEventListener('click', undo);
    redoButton && redoButton.removeEventListener('click', redo);

    var cells = utils.dom('.sudoku__table-cell');[].forEach.call(cells, function (cell) {
      cell.removeEventListener('keyup', onKeyUpCell);
    });

    window.removeEventListener('keydown', keyDown);
  }

  function restoreCaretPosition(cellIndex) {
    utils.cursorManager.setEndOfContenteditable(utils.dom('[data-cell-index="' + cellIndex + '"]')[0]);
  }

  function getSudoku() {
    return sudokuAdapter.generate({
      hints: HINTS,
      limit: TRY_LIMIT
    });
  }

  function validate(board) {
    var map = board.reduce(function (memo, row) {
      for (var _iterator = row, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
        var _ref;

        if (_isArray) {
          if (_i >= _iterator.length) break;
          _ref = _iterator[_i++];
        } else {
          _i = _iterator.next();
          if (_i.done) break;
          _ref = _i.value;
        }

        var num = _ref;

        memo.push(num);
      }
      return memo;
    }, []).map(function (num) {
      return parseInt(num, 10);
    });

    var validations = [];

    // Will validate one by one

    var _loop = function _loop() {
      if (_isArray2) {
        if (_i2 >= _iterator2.length) return 'break';
        _ref2 = _iterator2[_i2++];
      } else {
        _i2 = _iterator2.next();
        if (_i2.done) return 'break';
        _ref2 = _i2.value;
      }

      var _ref5 = _ref2;
      var index = _ref5[0];
      var number = _ref5[1];

      if (!number) {
        validations.push(new Promise(function (res) {
          res({ result: { box: -1, col: -1, row: -1 } });
        }));
      } else {
        var all = Promise.all(validations);
        validations.push(all.then(function () {
          return sudokuAdapter.validate({ map: map, number: number, index: index });
        }));
      }
    };

    for (var _iterator2 = map.entries(), _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _iterator2[Symbol.iterator]();;) {
      var _ref2;

      var _ret = _loop();

      if (_ret === 'break') break;
    }

    return Promise.all(validations).then(function (values) {
      var errors = [];
      for (var _iterator3 = values.entries(), _isArray3 = Array.isArray(_iterator3), _i3 = 0, _iterator3 = _isArray3 ? _iterator3 : _iterator3[Symbol.iterator]();;) {
        var _ref3;

        if (_isArray3) {
          if (_i3 >= _iterator3.length) break;
          _ref3 = _iterator3[_i3++];
        } else {
          _i3 = _iterator3.next();
          if (_i3.done) break;
          _ref3 = _i3.value;
        }

        var _ref4 = _ref3;
        var index = _ref4[0];
        var validation = _ref4[1];
        var _validation$result = validation.result;
        var box = _validation$result.box;
        var col = _validation$result.col;
        var row = _validation$result.row;

        var errorInBox = box.first !== box.last;
        var errorInCol = col.first !== col.last;
        var errorInRow = row.first !== row.last;

        var indexOfRow = Math.floor(index / 9);
        var indexInRow = index - indexOfRow * 9;

        errors[index] = errorInRow || errorInCol || errorInBox;
      }

      return errors;
    });
  }

  function render() {
    unbindEvents();

    DOM_TARGET.innerHTML = '\n      <div class=\'sudoku\'>\n        ' + headerComponent() + '\n        ' + contentComponent() + '\n      </div>\n    ';

    bindEvents();
  }

  function buttonComponent(props) {
    var id = props.id;
    var text = props.text;
    var mods = props.mods;
    var classes = props.classes;

    var blockName = 'button';
    var modifiers = {};
    var modType = toString.call(mods);
    if (modType === '[object String]') {
      modifiers[mods] = true;
    } else if (modType === '[object Array]') {
      for (var _iterator4 = mods, _isArray4 = Array.isArray(_iterator4), _i4 = 0, _iterator4 = _isArray4 ? _iterator4 : _iterator4[Symbol.iterator]();;) {
        var _ref6;

        if (_isArray4) {
          if (_i4 >= _iterator4.length) break;
          _ref6 = _iterator4[_i4++];
        } else {
          _i4 = _iterator4.next();
          if (_i4.done) break;
          _ref6 = _i4.value;
        }

        var modName = _ref6;

        modifiers[modName] = true;
      }
    }

    var blockClasses = bem.makeClassName({
      block: blockName,
      modifiers: modifiers
    });

    var buttonTextClass = blockName + '-text';
    if (Object.keys(modifiers).length) {
      buttonTextClass += Object.keys(modifiers).reduce(function (memo, curr) {
        return memo + (' ' + blockName + '--' + curr + '-text');
      }, '');
    }

    var lgText = typeof text === 'string' ? text : text[0];
    var mdText = typeof text === 'string' ? text : text[1];
    var smText = typeof text === 'string' ? text : text[2];

    return '\n      <button\n        id=\'' + id + '\'\n        class=\'' + blockClasses + ' ' + (classes || "") + '\'>\n        <span class=\'show-on-sm ' + buttonTextClass + '\'>\n          ' + smText + '\n        </span>\n        <span class=\'show-on-md ' + buttonTextClass + '\'>\n          ' + mdText + '\n        </span>\n        <span class=\'show-on-lg ' + buttonTextClass + '\'>\n          ' + lgText + '\n        </span>\n      </button>\n    ';
  }

  function messageComponent(options) {
    var _ref7;

    var state = options.state;
    var content = options.content;

    var messageClass = bem.makeClassName({
      block: 'message',
      modifiers: state ? (_ref7 = {}, _ref7[state] = true, _ref7) : {}
    });

    return '\n      <p class=\'' + messageClass + '\'>\n        ' + content + '\n      </p>\n    ';
  }

  function descriptionComponent(options) {
    var className = options.className;
    var infoLevel = options.infoLevel;

    var technical = '\n      In this demo,\n      <a href=\'https://en.wikipedia.org/wiki/Backtracking\'>\n        backtracking algorithm\n      </a> is used for <em>generating</em>\n      the sudoku.';

    var description = '\n      Difficulty and solvability is\n      totally random as I randomly left a certain number of hints\n      from a full-filled board.\n    ';

    if (infoLevel === 'full') {
      return '\n        <p class=\'' + (className || '') + '\'>\n          ' + technical + ' ' + description + '\n        </p>\n      ';
    } else if (infoLevel === 'mini') {
      return '\n        <p class=\'' + (className || '') + '\'>\n          ' + description + '\n        </p>\n      ';
    }
  }

  function restoreScrollPosComponent() {
    return '<div style=\'height: 540px\'></div>';
  }

  function headerComponent() {
    return '\n      <div class=\'sudoku__header\'>\n\n        <h1 class=\'sudoku__title\'>\n\n          <span class=\'show-on-sm\'>\n            Sudoku\n          </span>\n\n          <span class=\'show-on-md\'>\n            Sudoku Puzzle\n          </span>\n\n          <span class=\'show-on-lg\'>\n            Javascript Sudoku Puzzle Generator\n          </span>\n\n        </h1>\n\n        ' + descriptionComponent({
      infoLevel: 'mini',
      className: 'sudoku__description show-on-md'
    }) + '\n\n        ' + descriptionComponent({
      infoLevel: 'full',
      className: 'sudoku__description show-on-lg'
    }) + '\n\n        ' + (state.success ? '\n    \n              ' + buttonComponent({
      id: 'generate-button',
      text: ['New Board', 'New Board', 'New'],
      mods: 'primary'
    }) + '\n    \n              ' + (state.solved ? buttonComponent({
      id: 'solve-button',
      text: 'Solved',
      mods: ['tertiary', 'muted']
    }) : buttonComponent({
      id: 'solve-button',
      text: 'Solve',
      mods: 'secondary'
    })) + '\n\n            ' : '\n    \n              ' + buttonComponent({
      id: 'generate-button',
      text: ['Generating', '', ''],
      mods: ['disabled', 'loading']
    }) + '\n    \n              ' + buttonComponent({
      id: 'solve-button',
      text: 'Solve',
      mods: 'disabled'
    }) + '\n            ') + '\n\n        ' + (utils.isTouchDevice() ? '\n\n          ' + buttonComponent({
      id: 'redo-button',
      text: ['&raquo;', '&raquo;', '&gt;', '&gt;'],
      classes: 'fr',
      mods: ['neutral', 'compound', 'compound-last', '' + (!historyStash.length ? 'disabled' : '')]
    }) + '\n          ' + buttonComponent({
      id: 'undo-button',
      text: ['&laquo;', '&laquo;', '&lt;', '&lt;'],
      classes: 'fr',
      mods: ['neutral', 'compound', 'compound-first', '' + (history.length > 1 ? '' : 'disabled')]
    }) + '\n\n      ' : '') + '\n\n      </div>\n    ';
  }

  function contentComponent() {
    var _isSeparator = function _isSeparator(index) {
      return !!index && !((index + 1) % 3);
    };

    var resultReady = !!state.board;
    var fail = resultReady && !state.success;

    if (!resultReady) {
      return '\n        ' + messageComponent({
        state: 'busy',
        content: 'Generating new board...'
      }) + '\n        ' + restoreScrollPosComponent() + '\n      ';
    }

    if (fail) {
      return '\n        ' + messageComponent({
        state: 'fail',
        content: 'Something went wrong with this board, try generating another one.'
      }) + '\n        ' + restoreScrollPosComponent() + '\n      ';
    }

    var rows = state.board;

    return '\n      <table class=\'sudoku__table\'>\n\n        ' + rows.map(function (row, index) {
      var className = bem.makeClassName({
        block: 'sudoku',
        element: 'table-row',
        modifiers: {
          separator: _isSeparator(index)
        }
      });

      return '<tr class=\'' + className + '\'>\n\n              ' + row.map(function (num, _index) {
        var cellIndex = index * 9 + _index;
        var separator = _isSeparator(_index);
        var editable = typeof num !== 'number';
        var error = state.errors[cellIndex];
        var className = bem.makeClassName({
          block: 'sudoku',
          element: 'table-cell',
          modifiers: {
            separator: separator,
            editable: editable,
            error: error,
            'editable-error': editable && error
          }
        });

        return '\n\t\n                  <td class=\'' + className + '\'\n                      data-cell-index=\'' + cellIndex + '\'\n                      ' + (editable ? 'contenteditable' : '') + '>\n                        ' + num + '\n                  </td>';
      }).join('') + '\n\n            \n</tr>\n';
    }).join('') + '\n\n      </table>\n    ';
  }

  return { initialize: initialize };
}(SUDOKU_APP_CONFIG).initialize();