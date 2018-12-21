import { assert } from '@ember/debug';
import { cancel, debounce } from '@ember/runloop';
import { IDestroyable, IMap } from './interfaces';
import { registerDisposable } from './utils/disposable';

interface PendingDebounce {
  debouncedTask: Function;
  cancelId: EmberRunTimer;
}

/**
 * A map of instances/debounce functions that allows us to
 * store pending debounces per instance.
 *
 * @private
 *
 */
const registeredDebounces: IMap<
  Object,
  Map<string, PendingDebounce>
> = new WeakMap<Object, any>();

/**
   Runs the function with the provided name after the timeout has expired on the last
   invocation. The timer is properly canceled if the object is destroyed before it is
   invoked.

   Example:

   ```js
   import Component from 'ember-component';
   import { debounceTask, runDisposables } from 'ember-lifeline';

   export default Component.extend({
     logMe() {
       console.log('This will only run once every 300ms.');
     },

     click() {
       debounceTask(this, 'logMe', 300);
     },

     willDestroy() {
       this._super(...arguments);

       runDisposables(this);
     }
   });
   ```

   @method debounceTask
   @param { Object } obj the instance to register the task for
   @param { String } name the name of the task to debounce
   @param { ...* } debounceArgs arguments to pass to the debounced method
   @param { Number } wait the amount of time to wait before calling the method (in milliseconds)
   @public
   */
export function debounceTask(
  obj: IDestroyable,
  name: string,
  ...debounceArgs: any[]
): void | undefined {
  assert(
    `Called \`debounceTask\` without a string as the first argument on ${obj}.`,
    typeof name === 'string'
  );
  assert(
    `Called \`obj.debounceTask('${name}', ...)\` where 'obj.${name}' is not a function.`,
    typeof obj[name] === 'function'
  );
  assert(
    `Called \`debounceTask\` on destroyed object: ${obj}.`,
    !obj.isDestroyed
  );
  const wait = debounceArgs[debounceArgs.length - 1];
  assert(
    `Called \`debounceTask\` with incorrect \`wait\` argument. Expected Number and received \`${wait}\``,
    Number.isInteger(wait)
  )

  let pendingDebounces = registeredDebounces.get(obj);
  if (!pendingDebounces) {
    pendingDebounces = new Map();
    registeredDebounces.set(obj, pendingDebounces);
    registerDisposable(obj, getDebouncesDisposable(pendingDebounces));
  }

  let debouncedTask: Function;

  if (!pendingDebounces.has(name)) {
    debouncedTask = (...args) => {
      pendingDebounces.delete(name);
      obj[name](...args);
    };
  } else {
    debouncedTask = pendingDebounces.get(name)!.debouncedTask;
  }

  // cancelId is new, even if the debounced function was already present
  let cancelId = debounce(obj as any, debouncedTask as any, ...debounceArgs);

  pendingDebounces.set(name, { debouncedTask, cancelId });
}

/**
   Cancel a previously debounced task.

   Example:

   ```js
   import Component from 'ember-component';
   import { debounceTask, cancelDebounce } from 'ember-lifeline';

   export default Component.extend({
     logMe() {
       console.log('This will only run once every 300ms.');
     },

     click() {
       debounceTask(this, 'logMe', 300);
     },

     disable() {
        cancelDebounce(this, 'logMe');
     },

     willDestroy() {
       this._super(..arguments);
       runDisposables(this);
     }
   });
   ```

   @method cancelDebounce
   @param { Object } obj the instance to register the task for
   @param { String } methodName the name of the debounced method to cancel
   @public
   */
export function cancelDebounce(
  obj: IDestroyable,
  name: string
): void | undefined {
  if (!registeredDebounces.has(obj)) {
    return;
  }
  const pendingDebounces = registeredDebounces.get(obj);

  if (!pendingDebounces.has(name)) {
    return;
  }
  const { cancelId } = pendingDebounces.get(name)!;

  pendingDebounces.delete(name);
  cancel(cancelId);
}

function getDebouncesDisposable(
  debounces: Map<string, PendingDebounce>
): Function {
  return function() {
    if (debounces.size === 0) {
      return;
    }

    debounces.forEach(p => cancel(p.cancelId));
  };
}
