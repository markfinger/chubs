import * as babylon from 'babylon';
import {isUndefined, isString, isObject} from 'lodash/lang';

export function createBabylonOptions(options) {
  if (!isObject(options)) {
    options = {}
  }

  if (isUndefined(options.sourceType)) {
    options.sourceType = 'module';
  }

  return options;
}

export function buildBabylonAst(text, options, cb) {
  let ast;

  options = createBabylonOptions(options);

  try {
    ast = babylon.parse(text, options);
  } catch(err) {
    return cb(err);
  }

  cb(null, ast);
}

export function buildBabylonAstWithWorkers(text, options, workers, cb) {
  workers.callFunction({
    filename: __filename,
    name: buildBabylonAst.name,
    args: [text, options]
  }, cb);
}

export function createBabylonParser(babylonOptions) {
  return function babylonParser(options, pipeline, cb) {
    const {text, file} = options;
    const {workers, cache} = pipeline;

    if (!isString(text)) {
      return cb(new Error(`A \`text\` option must be provided: ${JSON.stringify(options)}`))
    }

    // TODO replace `text` with `file` (need to ensure that perf tests pass separate caches

    cache.get(text, (err, ast) => {
      if (err) return cb(err);

      if (isObject(ast)) {
        return cb(null, ast);
      }

      buildBabylonAstWithWorkers(text, babylonOptions, workers, (err, ast) => {
        if (err) return cb(err);

        cache.set(text, ast, (err) => {
          if (err) return cb(err);

          cb(null, ast);
        })
      });
    });
  }
}