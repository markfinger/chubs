import * as path from 'path';
import * as async from 'async';
import * as fs from 'fs';
import {assert} from '../utils/assert';
import {createPipeline} from '../pipeline/pipeline';
import {createBrowserResolver} from '../dependencies/browser_resolve';
import {createBabelAstDependencyAnalyzer} from '../dependencies/babel_ast_dependency_analyzer';
import {createBabylonParser} from '../parsers/babylon';
import {createTextReader} from '../content_readers/text_reader';
import {createWorkerFarm} from '../workers/worker_farm';
import {createPersistentCache} from '../caches/persistent_cache';

function createBlobCache() {
  const cacheFile = path.join(__dirname, 'cache.json');
  let cache = Object.create(null);

  let _isReady = false;
  const _onReady = [];
  function onReady(cb) {
    if (_isReady) {
      cb();
    } else {
      _onReady.push(cb);
    }
  }

  fs.readFile(cacheFile, 'utf8', (err, text) => {
    _isReady = true;

    if (err) {
      console.log(err);
      return;
    }

    cache = JSON.parse(text);
    _onReady.forEach(cb => cb());
  });

  process.on('exit', () => {
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  });

  return {
    get(options, cb) {
      onReady(() => {
        if (cache[options.key]) {
          return cb(null, cache[options.key]);
        }
        cb(null, null);
      });
    },
    set(options, value, cb) {
      onReady(() => {
        cache[options.key] = value;
        cb(null);
      });
    }
  }
}

function trace(pipeline, cb) {
  const babylonParser = createBabylonParser();
  const browserResolver = createBrowserResolver();
  const babelAstDependencyAnalyzer = createBabelAstDependencyAnalyzer();
  const textReader = createTextReader();

  const tree = Object.create(null);

  function traceFile(file, cb) {
    tree[file] = [];

    async.waterfall([
      (cb) => textReader({file: file}, pipeline, cb),
      (text, cb) => babylonParser({text: text}, pipeline, cb),
      (ast, cb) => babelAstDependencyAnalyzer({ast: ast, file: file}, pipeline, cb),
      (deps, cb) => async.map(
        deps,
        (dependency, cb) => {
          browserResolver({dependency, basedir: path.dirname(file)}, pipeline, cb);
        },
        cb
      )
    ], (err, resolved) => {
      if (err) {
        err.message = `File: ${file}\n\n${err.message}`;
        return cb(err);
      }

      tree[file] = resolved;

      const untracedFiles = resolved.filter(file => !tree[file]);
      if (untracedFiles.length) {
        async.parallel(
          untracedFiles.map(file => (cb) => traceFile(file, cb)),
          cb
        );
      } else {
        cb(null);
      }
    });
  }

  async.parallel([
    (cb) => traceFile(require.resolve('redux'), cb),
    (cb) => traceFile(require.resolve('react'), cb),
    (cb) => traceFile(require.resolve('babylon'), cb)
  ], (err) => {
    cb(err, tree);
  });
}

module.exports = function tracerPerf(cb) {
  const start = (new Date).getTime();

  //// normal
  //const pipeline = createPipeline();
  //trace(pipeline, (err, tree) => {
  //  assert.isNull(err);
  //  assert.isObject(tree);
  //
  //  const end = (new Date).getTime() - start;
  //  console.log(`\n\nTraced ${Object.keys(tree).length} records in ${end}ms`);
  //
  //  cb();
  //});


  //// worker farm
  //const workers = createWorkerFarm();
  //const workerPipeline = createPipeline({
  //  workers
  //});
  //trace(workerPipeline, (err, tree) => {
  //  assert.isNull(err);
  //  assert.isObject(tree);
  //
  //  const end = (new Date).getTime() - start;
  //  console.log(`\n\nTraced ${Object.keys(tree).length} records in ${end}ms`);
  //
  //  workers.killWorkers();
  //
  //  cb();
  //});

  //// persistent cache
  //const cachePipeline = createPipeline({
  //  cache: createPersistentCache({dirname: __dirname + '/test-cache'})
  //});
  //trace(cachePipeline, (err, tree) => {
  //  assert.isNull(err);
  //  assert.isObject(tree);
  //
  //  const end = (new Date).getTime() - start;
  //  console.log(`\n\nTraced ${Object.keys(tree).length} records in ${end}ms`);
  //
  //  cb();
  //});

  // blob cache
  //const cachePipeline = createPipeline({
  //  cache: createBlobCache()
  //});
  //trace(cachePipeline, (err, tree) => {
  //  assert.isNull(err);
  //  assert.isObject(tree);
  //
  //  const end = (new Date).getTime() - start;
  //  console.log(`\n\nTraced ${Object.keys(tree).length} records in ${end}ms`);
  //
  //  cb();
  //});
};