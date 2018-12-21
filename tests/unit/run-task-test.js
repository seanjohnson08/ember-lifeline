import EmberObject from '@ember/object';
import { run } from '@ember/runloop';
import { cancelTask, runDisposables, runTask, scheduleTask, throttleTask, _setRegisteredTimers } from 'ember-lifeline';
import { module, test } from 'qunit';

module('ember-lifeline/run-task', function(hooks) {
  hooks.beforeEach(function() {
    this.BaseObject = EmberObject.extend();

    this.getComponent = function() {
      if (this._component) {
        return this._component;
      }

      return (this._component = this.BaseObject.create(...arguments));
    };
  });

  hooks.afterEach(function() {
    runDisposables(this.obj);
  });

  test('invokes async tasks', function(assert) {
    assert.expect(2);

    this.obj = this.getComponent();
    let done = assert.async();
    let hasRun = false;

    runTask(
      this.obj,
      () => {
        hasRun = true;
        assert.ok(true, 'callback was called');
        done();
      },
      0
    );

    assert.notOk(hasRun, 'callback should not have run yet');
  });

  test('invokes named functions as async tasks', function(assert) {
    assert.expect(3);

    let done = assert.async();
    let obj = (this.obj = this.getComponent({
      run() {
        hasRun = true;
        assert.equal(this, obj, 'context is correct');
        assert.ok(true, 'callback was called');
        done();
      },
    }));
    let hasRun = false;

    runTask(this.obj, 'run', 0);

    assert.notOk(hasRun, 'callback should not have run yet');
  });

  test('invokes async tasks with delay', function(assert) {
    assert.expect(3);

    this.obj = this.getComponent();
    let done = assert.async();
    let hasRun = false;

    runTask(
      this.obj,
      () => {
        hasRun = true;
        assert.ok(true, 'callback was called');
        done();
      },
      10
    );

    window.setTimeout(() => {
      assert.notOk(hasRun, 'callback should not have run yet');
    }, 5);

    assert.notOk(hasRun, 'callback should not have run yet');
  });

  test('runTask tasks can be canceled', function(assert) {
    assert.expect(1);

    this.obj = this.getComponent();
    let done = assert.async();
    let hasRun = false;

    let cancelId = runTask(
      this.obj,
      () => {
        hasRun = true;
      },
      5
    );

    cancelTask(cancelId);

    window.setTimeout(() => {
      assert.notOk(hasRun, 'callback should have been canceled previously');
      done();
    }, 10);
  });

  test('runTask tasks removed their cancelIds when run', function(assert) {
    assert.expect(1);

    let map = new Map();
    _setRegisteredTimers(map);
    this.obj = this.getComponent();
    let done = assert.async();

    runTask(
      this.obj,
      () => {
        assert.equal(
          map.get(this.obj).size,
          0,
          'Set deleted the cancelId after task executed'
        );
        _setRegisteredTimers(new WeakMap());
        done();
      },
      0
    );
  });

  test('scheduleTask invokes async tasks', function(assert) {
    assert.expect(3);

    this.obj = this.getComponent();
    let hasRun = false;

    run(() => {
      scheduleTask(this.obj, 'actions', () => {
        hasRun = true;
        assert.ok(true, 'callback was called');
      });

      assert.notOk(hasRun, 'callback should not have run yet');
    });

    assert.ok(hasRun, 'callback was called');
  });

  test('scheduleTask invokes named functions as async tasks', function(assert) {
    assert.expect(5);

    let obj = (this.obj = this.getComponent({
      run(name) {
        hasRun = true;
        assert.equal(this, obj, 'context is correct');
        assert.equal(name, 'foo', 'passed arguments are correct');
        assert.ok(true, 'callback was called');
      },
    }));
    let hasRun = false;

    run(() => {
      scheduleTask(this.obj, 'actions', 'run', 'foo');
      assert.notOk(hasRun, 'callback should not have run yet');
    });

    assert.ok(hasRun, 'callback was called');
  });

  test('scheduleTask tasks can be canceled', function(assert) {
    assert.expect(1);
    this.obj = this.getComponent();
    let hasRun = false;

    run(() => {
      let timer = scheduleTask(this.obj, 'actions', () => {
        hasRun = true;
      });

      cancelTask(timer);
    });

    assert.notOk(hasRun, 'callback should have been canceled previously');
  });

  test('scheduleTask tasks removed their cancelIds when run', function(assert) {
    assert.expect(1);

    let map = new Map();
    _setRegisteredTimers(map);
    this.obj = this.getComponent();
    let done = assert.async();

    run(() => {
      scheduleTask(this.obj, 'actions', () => {
        assert.equal(
          map.get(this.obj).size,
          0,
          'Set deleted the cancelId after task executed'
        );
        _setRegisteredTimers(new WeakMap());
        done();
      });
    });
  });

  test('throttleTask actually throttles', function(assert) {
    let callCount = 0;
    let callArgs;
    this.obj = this.getComponent({
      doStuff(...args) {
        callCount++;
        callArgs = args;
      }
    });

    run(() => {
      throttleTask(this.obj, 'doStuff', 'a', 5);
      throttleTask(this.obj, 'doStuff', 'b', 5);
      throttleTask(this.obj, 'doStuff', 'c', 5);
    });

    assert.equal(callCount, 1, 'Throttle only ran the method once');
    assert.deepEqual(callArgs, ['a'], 'Throttle was called with the arguments from the first call only');
  });

  test('throttleTask triggers an assertion when a string is not the first argument', function(assert) {
    this.obj = this.getComponent({ doStuff() {} });

    assert.throws(() => {
      throttleTask(this.obj, this.obj.doStuff, 5);
    }, /without a string as the first argument/);
  });

  test('throttleTask triggers an assertion the function name provided does not exist on the object', function(assert) {
    this.obj = this.getComponent();

    assert.throws(() => {
      throttleTask(this.obj, 'doStuff', 5);
    }, /is not a function/);
  });

  test('throttleTask triggers an assertion when timeout argument is not a number or not passed', function(assert) {
    this.obj = this.getComponent({ doStuff() {} });

    assert.throws(() => {
      throttleTask(this.obj, 'doStuff', 'bad');
    }, /with incorrect `timeout` argument. Expected Number and received `bad`/);
  });

  test('throttleTask passes arguments to method', function(assert) {
    let calledWithArgs;

    this.obj = this.getComponent({ doStuff(...args) {
      calledWithArgs = args;
    }});

    run(() => {
      throttleTask(this.obj, 'doStuff', 'hello', 'world', 5);
    });

    assert.deepEqual(calledWithArgs ['hello', 'world']);
  })
});
