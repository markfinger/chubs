import {Map, Set} from 'immutable';
import {isNodePending, isNodeDefined, ensureNodeIsPermanent, createGraph} from '../graph';
import {Node, addNode, removeNode, addEdge, removeEdge} from '../node';
import {createNodesFromNotation} from '../utils';
import {assert} from '../../utils/assert';

describe('directed-dependency-graph/graph', () => {
  describe('#createGraph', () => {
    describe('.traceNode', () => {
      it('should allow call the provided `getDependencies` function', (done) => {
        const graph = createGraph({getDependencies});

        function getDependencies(node) {
          assert.equal(node, 'test');
          done();
        }

        graph.traceNode('test');
      });
      it('should create a pending job for the node', () => {
        const graph = createGraph({getDependencies(){}});

        graph.traceNode('test');

        assert.isObject(graph.pendingJobs[0]);
        assert.equal(graph.pendingJobs[0].node, 'test');
        assert.isTrue(graph.pendingJobs[0].isValid);
      });
      it('should emit a `complete` signal once all the dependencies have been resolved', (done) => {
        const graph = createGraph({getDependencies});

        function getDependencies(name, cb) {
          cb(null, []);
        }

        graph.events.on('complete', () => {
          done();
        });

        graph.traceNode('test');
      });
      it('should populate the graph with the provided dependencies', (done) => {
        const graph = createGraph({getDependencies});

        function getDependencies(file, cb) {
          if (file === 'a') {
            cb(null, ['b', 'c']);
          } else {
            cb(null, []);
          }
        }

        graph.events.on('complete', () => {
          assert.isTrue(graph.isNodeDefined('a'));
          assert.isTrue(graph.isNodeDefined('b'));
          assert.isTrue(graph.isNodeDefined('c'));
          done();
        });

        graph.traceNode('a');
      });
    });
    describe('.pruneNode', () => {
      it('should allow nodes to be pruned', () => {
        const graph = createGraph({
          nodes: Map({
            test: Node()
          })
        });

        assert.isTrue(graph.isNodeDefined('test'));

        graph.pruneNode('test');
      });
      it('should emit `pruned` events', (done) => {
        const graph = createGraph({
          nodes: Map({
            test: Node()
          })
        });

        graph.events.on('pruned', (node) => {
          assert.equal(node, 'test');
          done();
        });

        graph.pruneNode('test');
      });
      it('should emit `pruned` events for all dependencies without dependents', (done) => {
        const graph = createGraph({
          nodes: createNodesFromNotation('a -> b')
        });

        let count = 0;
        graph.events.on('pruned', (node) => {
          count++;
          assert.include(['a', 'b'], node, 'should indicate that nodes "a" and "b" have been pruned');
          assert.include([1, 2], count);
          if (count > 1) {
            done();
          }
        });

        graph.pruneNode('a');
      });
      it('should not emit `pruned` events for any dependencies with other dependents', (done) => {
        const graph = createGraph({
          nodes: createNodesFromNotation(`
            a -> b
            c -> b
          `)
        });

        graph.setNodeAsEntry('a');
        graph.setNodeAsEntry('c');

        graph.events.on('pruned', (node) => {
          assert.equal(node, 'a');
          done();
        });

        graph.pruneNode('a');
      });
      it('should invalidate any pending jobs related to the pruned nodes', () => {
        const graph = createGraph();

        graph.pendingJobs.push({node: 'a', isValid: true});

        graph.pruneNode('a');

        assert.isFalse(graph.pendingJobs[0].isValid);
      });
      it('should invalidate any pending jobs for dependencies', () => {
        const graph = createGraph({
          nodes: createNodesFromNotation('a -> b')
        });

        graph.pendingJobs.push({node: 'b', isValid: true});

        graph.pruneNode('a');

        assert.isFalse(graph.pendingJobs[0].isValid);
      });
      it('should trigger `complete` after pruning a node', (done) => {
        const graph = createGraph({
          nodes: createNodesFromNotation('a')
        });

        graph.events.on('complete', () => {
          done();
        });

        graph.pruneNode('a');
      });
      it('should trigger `complete` if pending jobs are only for pruned dependencies', (done) => {
        const graph = createGraph({
          nodes: createNodesFromNotation('a -> b')
        });

        graph.pendingJobs.push({node: 'b', isValid: true});

        graph.events.on('complete', () => {
          assert.isFalse(graph.pendingJobs[0].isValid);
          done();
        });

        graph.pruneNode('a');
      });
      it('should not trigger `complete` if there are pending jobs for un-pruned dependencies', () => {
        const graph = createGraph({
          nodes: createNodesFromNotation('a')
        });

        graph.pendingJobs.push({node: 'b', isValid: true});

        graph.events.on('complete', () => {
          throw new Error('Should not be called');
        });

        graph.pruneNode('a');
      });
      it('should trigger `complete` if there are pending jobs that are no longer valid', (done) => {
        const graph = createGraph({
          nodes: createNodesFromNotation('a')
        });

        graph.pendingJobs.push({node: 'b', isValid: false});

        graph.events.on('complete', () => {
          done();
        });

        graph.pruneNode('a');
      });
      it('should handle cyclic graphs 1', () => {
        const graph = createGraph({
          nodes: createNodesFromNotation(`
            a -> b -> c -> b
          `)
        });

        graph.pruneNode('a');

        assert.equal(graph.getNodes(), Map());
      });
      it('should handle cyclic graphs 2', () => {
        const graph = createGraph({
          nodes: createNodesFromNotation(`
            a -> b -> c -> d -> b
          `)
        });

        graph.pruneNode('a');

        assert.equal(graph.getNodes(), Map());
      });
      it('should handle cyclic graphs 3', () => {
        const graph = createGraph({
          nodes: createNodesFromNotation(`
            a -> b -> c -> d -> b
            c -> b
          `)
        });

        graph.pruneNode('a');

        assert.equal(graph.getNodes(), Map());
      });
      it('should successfully prune a graph representing a tournament', () => {
        // https://en.wikipedia.org/wiki/Tournament_(graph_theory)

        const graph = createGraph({
          nodes: createNodesFromNotation(`
            a -> b
            a -> c
            a -> d
            b -> a
            b -> c
            b -> d
            c -> a
            c -> b
            c -> d
            d -> a
            d -> b
            d -> c
          `)
        });

        graph.setNodeAsEntry('a');

        graph.pruneNode('a');

        assert.equal(graph.getNodes(), Map());
      });
      it('should handle cyclic graphs 4', () => {
        const graph = createGraph({
          nodes: createNodesFromNotation(`
            a -> b -> c -> d -> b
            c -> b
          `)
        });

        graph.setNodeAsEntry('a');

        graph.pruneNode('b');

        assert.equal(
          graph.getNodes(),
          Map({
            a: Node({name: 'a', isEntryNode: true})
          })
        );
      });
    });
    describe('.isNodeDefined', () => {
      it('should indicate if a node has been defined', (done) => {
        const graph = createGraph({
          getDependencies(name, cb) {
            cb(null, []);
          }
        });

        assert.isFalse(graph.getNodes().has('test'));
        assert.isFalse(graph.isNodeDefined('test'));

        graph.traceNode('test');

        process.nextTick(() => {
          assert.isTrue(graph.getNodes().has('test'));
          assert.isTrue(graph.isNodeDefined('test'));
          done();
        });
      });
    });
    describe('.setNodeAsEntry', () => {
      it('should allow nodes to be denoted as entry nodes', () => {
        const graph = createGraph({
          nodes: createNodesFromNotation(`a -> b`)
        });
        graph.setNodeAsEntry('a');
        assert.isTrue(graph.getNodes().get('a').isEntryNode);
      });
      it('should be removed when pruned directly', (done) => {
        const graph = createGraph({
          nodes: createNodesFromNotation('a')
        });

        graph.setNodeAsEntry('a');

        graph.events.on('pruned', node => {
          assert.equal(node, 'a');
          done();
        });

        graph.pruneNode('a');
      });
      it('should not be removed when pruning dependencies', (done) => {
        const graph = createGraph({
          nodes: createNodesFromNotation(`
            a
            b -> a
          `)
        });

        graph.setNodeAsEntry('a');

        graph.events.on('pruned', node => {
          assert.equal(node, 'b');
          assert.isTrue(graph.isNodeDefined('a'));
          done();
        });

        graph.pruneNode('b');
      });
    });
  });
  describe('#isNodeDefined', () => {
    it('should indicate if a node has completed its dependency path', () => {
      let nodes = Map();
      assert.isFalse(isNodeDefined(nodes, 'test'));

      nodes = Map({test: Node()});
      assert.isTrue(isNodeDefined(nodes, 'test'));
    });
  });
  describe('#isNodePending', () => {
    it('should indicate if an active and pending job is associated with a node', () => {
      let pendingJobs = [{node: 'test', isValid: true}];
      assert.isTrue(isNodePending(pendingJobs, 'test'));

      pendingJobs = [{node: 'test', isValid: false}, {node: 'test', isValid: true}];
      assert.isTrue(isNodePending(pendingJobs, 'test'));

      pendingJobs = [{node: 'test', isValid: false}];
      assert.isFalse(isNodePending(pendingJobs, 'test'));

      pendingJobs = [{node: 'not test', isValid: false}];
      assert.isFalse(isNodePending(pendingJobs, 'test'));

      pendingJobs = [];
      assert.isFalse(isNodePending(pendingJobs, 'test'));
    });
  });
});
