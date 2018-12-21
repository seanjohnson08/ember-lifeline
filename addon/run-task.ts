import { deprecate } from '@ember/application/deprecations';
import { assert } from '@ember/debug';
import { cancel, later, schedule, throttle } from '@ember/runloop';
import { IDestroyable, IMap, TaskOrName } from './interfaces';
import { registerDisposable } from './utils/disposable';
import getTask from './utils/get-task';

/**
 * A map of instances/timers that allows us to
 * store cancelIds for scheduled timers per instance.
 *
 * @private
 *
 */
let registeredTimers: IMap<Object, Set<EmberRunTimer>> = new WeakMap<Object, any>();

/**
 * Test use only. Allows for swapping out the WeakMap to a Map, giving
 * us the ability to detect whether the timers set is empty.
 *
 * @private
 * @param {*} mapForTesting A map used to ensure correctness when testing.
 */
export function _setRegisteredTimers(
  mapForTesting: IMap<Object, Set<EmberRunTimer>>
) {
  registeredTimers = mapForTesting;
}

/**
   Registers and runs the provided task function for the provided object at the specified
   timeout (defaulting to 0). The timer is properly canceled if the object is destroyed
   before it is invoked.

   Example:

   ```js
   import Component from 'ember-component';
   import { runTask, runDisposables } from 'ember-lifeline';

   export default Component.extend({
     didInsertElement() {
       runTask(this, () => {
         console.log('This runs after 5 seconds if this component is still displayed');
       }, 5000)
     },

     willDestroy() {
       this._super(...arguments);
       runDisposables(this);
     }
   });
   ```

   @function runTask
   @param { Object } obj the instance to register the task for
   @param { Function | String } taskOrName a function representing the task, or string
                                           specifying a property representing the task,
                                           which is run at the provided time specified
                                           by timeout
   @param { Number } [timeout=0] the time in the future to run the task
   @public
   */
export function runTask(
  obj: IDestroyable,
  taskOrName: TaskOrName,
  timeout: number = 0
): EmberRunTimer {
  assert(`Called \`runTask\` on destroyed object: ${obj}.`, !obj.isDestroyed);

  let task: Function = getTask(obj, taskOrName, 'runTask');
  let timers: Set<EmberRunTimer> = getTimers(obj);
  let cancelId: EmberRunTimer = later(() => {
    timers.delete(cancelId);
    task.call(obj);
  }, timeout);

  timers.add(cancelId);
  return cancelId;
}

/**
   Adds the provided function to the named queue for the provided object. The timer is
   properly canceled if the object is destroyed before it is invoked.

   Example:

   ```js
   import Component from 'ember-component';
   import { scheduleTask, runDisposables } from 'ember-lifeline';

   export default Component.extend({
     init() {
       this._super(...arguments);
       scheduleTask(this, 'actions', () => {
         console.log('This runs at the end of the run loop (via the actions queue) if this component is still displayed');
       })
     },

     willDestroy() {
       this._super(...arguments);
       runDisposables(this);
     }
   });
   ```

   @function scheduleTask
   @param { Object } obj the instance to register the task for
   @param { String } queueName the queue to schedule the task into
   @param { Function | String } taskOrName a function representing the task, or string
                                           specifying a property representing the task,
                                           which is run at the provided time specified
                                           by timeout
   @param { ...* } args arguments to pass to the task
   @public
   */
export function scheduleTask(
  obj: IDestroyable,
  queueName: EmberRunQueues,
  taskOrName: TaskOrName,
  ...args: any[]
): EmberRunTimer {
  assert(
    `Called \`scheduleTask\` without a string as the first argument on ${obj}.`,
    typeof queueName === 'string'
  );
  assert(
    `Called \`scheduleTask\` while trying to schedule to the \`afterRender\` queue on ${obj}.`,
    queueName !== 'afterRender'
  );
  assert(
    `Called \`scheduleTask\` on destroyed object: ${obj}.`,
    !obj.isDestroyed
  );

  let task: Function = getTask(obj, taskOrName, 'scheduleTask');
  let timers: Set<EmberRunTimer> = getTimers(obj);
  let cancelId: EmberRunTimer;
  let taskWrapper: Function = (...taskArgs) => {
    timers.delete(cancelId);
    task.call(obj, ...taskArgs);
  };
  cancelId = schedule(queueName, obj as any, taskWrapper, ...args);

  timers.add(cancelId);

  return cancelId;
}

/**
   Runs the function with the provided name immediately, and only once in the time window
   specified by the timeout argument.

   Example:

   ```js
   import Component from 'ember-component';
   import { throttleTask, runDisposables } from 'ember-lifeline';

   export default Component.extend({
     logMe() {
       console.log('This will run once immediately, then only once every 300ms.');
     },

     click() {
       throttleTask(this, 'logMe', 300);
     },

     destroy() {
       runDisposables(this);
     }
   });
   ```

   @method throttleTask
   @param { Object } obj the instance to register the task for
   @param { String } taskName the name of the task to throttle
   @param { ...* } [throttleArgs] arguments to pass to the throttled method
   @param { Number } timeout the time in the future to run the task
   @public
   */
export function throttleTask(
  obj: IDestroyable,
  taskName: string,
  ...throttleArgs: any[]
): EmberRunTimer {

  assert(
    `Called \`throttleTask\` without a string as the first argument on ${obj}.`,
    typeof taskName === 'string'
  );
  assert(
    `Called \`throttleTask('${taskName}')\` where '${taskName}' is not a function.`,
    typeof obj[taskName] === 'function'
  );
  assert(
    `Called \`throttleTask\` on destroyed object: ${obj}.`,
    !obj.isDestroyed
  );
  const timeout = throttleArgs[throttleArgs.length - 1];
  assert(
    `Called \`throttleTask\` with incorrect \`timeout\` argument. Expected Number and received \`${timeout}\``,
    Number.isInteger(timeout)
  )

  let timers: Set<EmberRunTimer> = getTimers(obj);
  let cancelId: EmberRunTimer = throttle(obj as any, taskName, ...throttleArgs);

  timers.add(cancelId);

  return cancelId;
}

/**
   Cancel a previously scheduled task.

   Example:

   ```js
   import Component from 'ember-component';
   import { runTask, cancelTask } from 'ember-lifeline';

   export default Component.extend({
     didInsertElement() {
       this._cancelId = runTask(this, () => {
         console.log('This runs after 5 seconds if this component is still displayed');
       }, 5000)
     },

     disable() {
        cancelTask(this, this._cancelId);
     },

     willDestroy() {
       this._super(...arguments);
       runDisposables(this);
     }
   });
   ```

   @method cancelTask
   @param { Object } obj the entangled object that was provided with the original *Task call
   @param { Number } cancelId the id returned from the *Task call
   @public
   */
export function cancelTask(cancelId: EmberRunTimer);
export function cancelTask(obj: IDestroyable, cancelId: EmberRunTimer);
export function cancelTask(
  obj: IDestroyable | EmberRunTimer,
  cancelId?: any
): void | undefined {
  if (typeof cancelId === 'undefined') {
    deprecate(
      'ember-lifeline cancelTask called without an object. New syntax is cancelTask(obj, cancelId) and avoids a memory leak.',
      true,
      {
        id: 'ember-lifeline-cancel-task-without-object',
        until: '4.0.0',
      }
    );
    cancelId = obj;
  } else {
    let timers: Set<EmberRunTimer> = getTimers(obj);
    timers.delete(cancelId);
  }
  cancel(cancelId);
}

function getTimersDisposable(
  obj: IDestroyable,
  timers: Set<EmberRunTimer>
): Function {
  return function() {
    timers.forEach(cancelId => {
      cancelTask(obj, cancelId);
    });
    timers.clear();
  };
}

function getTimers(obj): Set<EmberRunTimer> {
  let timers = registeredTimers.get(obj);

  if (!timers) {
    timers = new Set<EmberRunTimer>();
    registeredTimers.set(obj, timers);
    registerDisposable(obj, getTimersDisposable(obj, timers));
  }

  return timers;
}
