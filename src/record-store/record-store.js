import {forOwn} from 'lodash/object';
import {isString, isObject, isFunction} from 'lodash/lang';
import imm from 'immutable';
import {
  createIntercept, isIntercept, isRecordRemovedIntercept, isRecordInvalidIntercept
} from './intercept';

export const Record = imm.Record({
  name: null,
  reference: null,
  jobs: imm.Map()
});

export const Reference = imm.Record({
  name: null,
  reference: null
});

export function createRecordStore(functions={}) {
  let state = imm.Map();

  const store = {
    getState() {
      return state;
    },
    create(name) {
      state = createRecord(state, name)
    },
    has(name) {
      return state.has(name)
    },
    get(name) {
      return state.get(name)
    },
    remove(name) {
      state = state.remove(name)
    },
    isIntercept,
    isRecordRemovedIntercept,
    isRecordInvalidIntercept
  };

  const jobStore = {};

  forOwn(functions, (value, key) => {
    if (!isFunction(value)) {
      throw new Error(`Properties should only be functions. Received \`${key}: ${value}\``)
    }

    if (store.hasOwnProperty(key)) {
      throw new Error(`Property name "${key}" conflicts with the record store's API`);
    }

    Object.defineProperty(store, key, {
      value: createRequestHandler(key, value),
      enumerable: true
    });

    Object.defineProperty(jobStore, key, {
      value: createJobHandler(key, value)
    });
  });

  function createRequestHandler(propName, func) {
    return function requestHandler(name) {
      throwIfUnknownRecord(state, name);

      const record = store.get(name);

      const ref = Reference({
        name,
        reference: record.reference,
        origin: propName
      });

      return Promise.resolve(ref).then(jobStore[propName])
        .catch(err => {
          if (isIntercept(err)) {
            return Promise.reject(err);
          }

          const intercept = createIntercept(state, ref);
          if (intercept) {
            return intercept;
          }


          //if (!isIntercept(err)) {
          //  const intercept = createIntercept(state, ref);
          //  if (intercept) {
          //    return intercept;
          //  }
          //}

          return Promise.reject(err);
        })
        .then(data => {
          const intercept = createIntercept(state, ref);
          if (intercept) {
            return intercept;
          }

          return data;
        });
    }
  }

  function createJobHandler(propName, func) {
    return function jobHandler(ref) {
      if (!(ref instanceof Reference)) {
        throw new Error(
          `Failed to provide a Reference when calling ${propName}. ` +
          `Received ${typeof ref}: ${ref}`
        );
      }

      const intercept = createIntercept(state, ref);
      if (intercept) {
        return intercept;
      }

      const record = state.get(ref.name);
      const jobs = record.get('jobs');
      if (jobs.has(propName)) {
        return jobs.get(propName);
      }

      const promise = Promise.resolve()
        // Wrap the call to `func` in a promise so that any thrown errors
        // are passed along the chain
        .then(() => func(ref, jobStore))
        // Check if the value is still valid, if not allow the intercept
        // to take over
        .then(data => {
          const intercept = createIntercept(state, ref);
          if (intercept) {
            return intercept;
          }

          return data;
        });

      const updatedJobs = jobs.set(propName, promise);
      const updatedRecord = record.set('jobs', updatedJobs);
      state = state.set(record.name, updatedRecord);

      return promise;
    }
  }

  return store;
}

export function createRecord(state, name) {
  throwIfInvalidName(name);

  if (state.has(name)) {
    throw new Error(`Record "${name}" already exists`);
  }

  const record = Record({
    name,
    // An object that is used for strict equality checks to
    // match files to file references. Alternatively, we could
    // use UUIDs or timestamps, but this is simpler, avoids
    // edge-cases and works well for our purposes
    reference: {}
  });

  return state.set(name, record);
}

export function throwIfInvalidName(name) {
  if (!name || !isString(name)) {
    throw new Error(`"${name}" is not a valid record name`);
  }
}

export function throwIfUnknownRecord(state, name) {
  throwIfInvalidName(name);

  if (!state.has(name)) {
    throw new Error(`Unknown record "${name}"`);
  }
}