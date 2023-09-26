'use strict';
/**
 * Usage:
 * ------
 * let time = NextState()
 * 
 * // ... User performs action.
 * // const next = apply(time.state, action)
 * const proposal = time.propose(next)
 * time.advance(proposal)
 * // ... Should now send proposal to all peers.
 * 
 * // ... Receives proposal from peers.
 * // group.addEventListener('message', ({data}) => {...})
 * const {accept, code, reason} = time.evaluate(proposal)
 * if (accept) {
 *   time = time.advance(proposal)
 * } else {
 *   console.warn(reason)
 * }
 */

export class NextState {
  // All good. Advance to the next state.
  static ADVANCE = 0;
  // The received state change departs not from ours.
  static ADVANCE_SHIFT = 1;
  // The received state change is more than one time step ahead.
  static FAST_FORWARD = 2;
  // The received state confirms ours. No need to do anything.
  static CONFIRM = 3;
  // Alternative state, they win, we adapt.
  static LOTTERY_LOST = 4;
  // Alternative state, they lose, we stay.
  static ROCK = 5;
  // The received state change lies in the past. Don't look back.
  static ONE_DIRECTION = 6;

  constructor({ state, time, lottery } = {}) {
    this.state = state ?? '';
    this.time = time ?? 0;
    this.lottery = lottery ?? Math.random();
  }

  /**
   * Applies the given transition (=proposal), returns the next state.
   */
  advance({ next, time, lottery }) {
    return new NextState({ state: next, time, lottery });
  }

  /**
   * Evaluates an incoming proposal.
   *
   * Returns an object with three values:
   * - 'accept': a boolean. If true, we can accept the proposed change.
   * - 'code': a label telling in what way the proposal will change our state.
   * - 'reason': a message with human-readable information about the change.
   */
  evaluate({ state, next, time, lottery }) {
    const result = {
      accept: false,
      reason: '',
      code: 0,
    };

    if (time > this.time) {
      // Remote is ahead of us.
      if (time > this.time + 1) {
        result.code = NextState.FAST_FORWARD;
        result.reason = `Skip ${time - this.time} steps.`;
        result.accept = true;
      } else if (state === this.state) {
        result.code = NextState.ADVANCE;
        result.reason = 'All good.';
        result.accept = true;
      } else {
        result.code = NextState.ADVANCE_SHIFT;
        result.reason = `Input source (${state}) ≠ local state (${this.state}).`;
        result.accept = true;
      }
    } else if (time === this.time) {
      // Receive a possibly conflicting state. Highest lottery number wins.
      if (next === this.state) {
        result.code = NextState.CONFIRM;
        result.reason = 'Transition confirms local state. No need to change.';
        result.accept = false;
      } else if (lottery > this.lottery) {
        result.code = NextState.LOTTERY_LOST;
        result.reason = `Their ticket won (${lottery} > ${this.lottery}).`;
        result.accept = true;
      } else {
        result.code = NextState.ROCK;
        result.reason = 'They got scissors, we got rock.';
        result.accept = false;
      }
    } else if (time < this.time) {
      // Remote is lagging behind.
      result.code = NextState.ONE_DIRECTION;
      result.reason = `Remote is ${this.time - time} steps behind.`;
      result.accept = false;
    }

    return result;
  }

  /**
   * Generates a proposal for the next state.
   */
  propose(next) {
    const state = this.state;
    const time = this.time + 1;
    const lottery = Math.random();
    return { next, state, time, lottery };
  }
}

/**
 * A directed graph class where at most one edge leads into each vertex.
 * That means paths can split but not join.
 *
 * This representation is useful to represent state in a peer-to-peer world:
 * Each node in the graph describes a specific state and the edges represent
 * state transitions (actions or events).
 * Although the peers try to maintain a single shared state, sometimes they may
 * perform different actions at the same time. In that case the graph diverges.
 * Different peers temporarily end up in different states. As more actions are
 * performed, one of the branches grows more rapidly than the other and
 * eventually all peers converge to (hop onto) the longest path = furthest
 * progressed state.
 *
 */
export class DivergingGraph extends EventTarget {
  #t = 0;
  #furthestNode = null;

  constructor() {
    super();
    // nodeInfo = Map target -> {source, distance, _t, data}
    // data = {action, ...}

    this.nodeInfo = new Map([[null, { distance: -1, _t: 0 }]]);
    this.heads = new Set();

    this.#furthestNode = null;
    this.#t = 1;
  }

  get furthestNode() {
    return this.#furthestNode;
  }

  set furthestNode(node) {
    if (node !== this.#furthestNode) {
      const info = this.nodeInfo.get(node);
      const detail = { node, info };
      const event = new CustomEvent('advance', { detail });

      this.#furthestNode = node;
      this.dispatchEvent(event);
    }
  }

  get size() {
    // Remove the "null" node from the size.
    return this.nodeInfo.size - 1;
  }

  addEdge(source, target, data) {
    const nodeInfo = this.nodeInfo;
    const heads = new Set(this.heads);
    let furthestNode = this.furthestNode;

    if (nodeInfo.has(source)) {
      heads.delete(source);
      this.heads = heads;
    } else {
      // Start a new path.
      nodeInfo.set(source, {
        source: null,
        distance: 0,
        _t: this.#t++,
        data: undefined,
      });
    }

    const targetDistance = nodeInfo.get(source).distance + 1;

    if (nodeInfo.has(target)) {
      // Link into existing path(s). Must be into that path's start.

      const currentTargetInfo = nodeInfo.get(target);

      if (currentTargetInfo.source || currentTargetInfo.distance !== 0) {
        throw 'The graph can only split, not join.';
      }

      // Traverse all paths to update path lengths.
      const followsTarget = new Map([
        [target, true],
        [null, false],
      ]);

      for (let node of heads) {
        const path = [];

        while (!followsTarget.has(node)) {
          path.push(node);
          node = nodeInfo.get(node).source;
        }

        const value = followsTarget.get(node);
        path.forEach((n) => followsTarget.set(n, value));
      }

      const updatedNodes = [...followsTarget]
        .filter(([_, follows]) => follows)
        .map(([node]) => node);

      updatedNodes.forEach((node) => {
        const info = nodeInfo.get(node);
        nodeInfo.set(node, {
          ...info,
          distance: info.distance + targetDistance,
        });
      });

      this.furthestNode = updatedNodes.reduce((a, b) => {
        const { distance: la, _t: ta } = nodeInfo.get(a);
        const { distance: lb, _t: tb } = nodeInfo.get(b);
        return la > lb ? a : la < lb ? b : ta < tb ? a : b;
      }, furthestNode);

      // Can assign because nodeInfo.set(target, ...) was called above
      // (with a new distance).
      Object.assign(nodeInfo.get(target), { source, data });
    } else {
      nodeInfo.set(target, {
        source,
        distance: targetDistance,
        _t: this.#t++,
        data,
      });

      heads.add(target);
      this.heads = heads;

      if (targetDistance > nodeInfo.get(furthestNode).distance) {
        this.furthestNode = target;
      }
    }
  }

  /**
   * Chops tails off paths.
   *
   * Each node is awarded score as a sum of two values:
   * - the node's distance, and
   * - the maximum value of _t over all nodes in its tail (including self).
   * The maxSize highest scoring nodes are kept.
   */
  prune(maxSize) {
    const size = this.size;

    const nodeInfo = new Map(this.nodeInfo);
    const heads = new Set(this.heads);

    const scores = new Map([
      [null, nodeInfo.get(null).distance + nodeInfo.get(null)._t],
    ]);

    for (let node of heads) {
      const path = [];

      while (!scores.has(node)) {
        path.push(node);
        node = nodeInfo.get(node).source;
      }

      let score = scores.get(node);

      for (let n of path.reverse()) {
        const { distance, _t } = nodeInfo.get(n);
        score = Math.max(score - (distance - 1), _t) + distance;
        scores.set(n, score);
      }
    }
    if (maxSize < size) {
      const sorted = [...nodeInfo].sort(
        ([a, { _t: ta }], [b, { _t: tb }]) => ta - tb
      );

      nodeInfo = this.nodeInfo = new Map(sorted.toSpliced(1, size - maxSize));

      nodeInfo.forEach((info) => {
        if (!nodeInfo.has(info.source)) {
          info.source = null;
        }
      });
    }
  }

  removeNode(target) {
    const nodeInfo = this.nodeInfo;
    const source = nodeInfo.get(target)?.source;

    nodeInfo.delete(target);
    nodeInfo.forEach((info) => {
      if (info.source === target) {
        info.source = null;
      }
    });

    if (target === this.furthestNode) {
      this.furthestNode = [...nodeInfo.keys()].reduce((a, b) => {
        const { distance: la, _t: ta } = nodeInfo.get(a);
        const { distance: lb, _t: tb } = nodeInfo.get(b);
        return la > lb ? a : la < lb ? b : ta < tb ? a : b;
      }, source ?? null);
    }
  }
}

export function test() {
  const dg = new DivergingGraph();

  dg.addEventListener('advance', ({ detail }) =>
    console.log('DivergingGraph advance detail:', detail)
  );

  dg.addEdge('C', 'D'); // event: "advance", node = D
  dg.addEdge('E', 'F');
  dg.addEdge('F', 'G'); // event: "advance", node = G
  dg.addEdge('A', 'B');
  dg.addEdge('B', 'C'); // event: "advance", node = D
  dg.addEdge('B', 'E'); // event: "advance", node = G
  console.log([...dg.nodeInfo.entries()]);
  /**
   * -> A -> B -> C -> D
   *          \-> E -> F -> G
   */

  dg.removeNode('E'); // no event, G still has longest path.
  dg.removeNode('G'); // event: "advance", node = D
  dg.addEdge('D', 'G'); // event: "advance", node = G
  // (The above statement is fine. G was forgotten so can be readded.)
  console.log([...dg.nodeInfo.entries()]);
  /**
   * -> A -> B -> C -> D -> G
   *                -> F
   *
   * Note there is no way to reattach a path to E because its path
   * length is 2. (`dg.nodeInfo.get('E').distance`)
   */

  console.log(dg.size); // 6
  dg.prune(3); // keep D, F and G: the three furthest nodes.
  console.log([...dg.nodeInfo.entries()]);
  /**
   * -> A -> B           -> G
   *                -> F
   */

  dg.addEdge('D', 'F'); // fail.
  // (The above statement fails because, although F's source is null,
  // its distance > 0.)
  console.log(dg);
}
