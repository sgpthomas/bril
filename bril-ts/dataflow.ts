import * as bril from './bril';

export type Node = {
  succs: Set<Node>,
  preds: Set<Node>,
  instr: bril.Instruction | "start"
  priority: number | undefined,
};

/**
 * Very simply Priority Queue implementation
 */
class PQueue<T> {
  t: Set<T>;
  /** compare(t1, t2) is true when t1 is better than t2 */
  compare: (t1: T, t2: T) => boolean;
  constructor(compare: (a: T, b: T) => boolean) {
    this.t = new Set();
    this.compare = compare;
  }
  isEmpty() {
    return this.t.size === 0;
  }
  add(item: T) {
    this.t.add(item);
  }
  next(): T | undefined {
    let best: T | undefined = undefined;
    for (let item of this.t) {
      if (!best) {
        best = item;
      } else {
        if (this.compare(best, item))
          best = item
      }
    }
    if (best) this.t.delete(best);
    return best;
  }
}

/**
 * subset(s1, s2) is true when s1 is a subset of s2
 */
function subset<T>(s1: Set<T>, s2: Set<T>): boolean {
  // console.log("subset", s1, s2);
  for (let elem of s1) {
    if (s2.has(elem)) continue;
    else return false;

  }
  return true;
}

function nodeCompare(t1: Node, t2: Node): boolean {
  if (t1.priority && t2.priority) {
    return t1.priority > t2.priority;
  }
  return t1.priority !== undefined;
}

/**
 * Checks to make sure that none of node's preds are in group.
 */
export function dependenciesOk(node: Node, group: Array<bril.Instruction>): boolean {
  for (let req of node.preds) {
    if (req.instr !== "start") {
      if (group.includes(req.instr)) return false;
    }
  }
  return true;
}

export function listSchedule(
  dag: Node,
  valid: (instrs: Array<bril.Instruction>, cand: bril.Instruction) => boolean
): Array<Array<bril.Instruction>> {
  // a queue that holds nodes that are ready to be scheduled (no predecessors left unscheduled)
  let queue: PQueue<Node> = new PQueue(nodeCompare);

  // initialize queue
  for (let node of dag.succs) {
    // if node has no preds, add to queue
    if (node.preds.size === 0) {
      queue.add(node)
    }
  }

  // set of nodes that have already been scheduled
  let scheduled: Set<Node> = new Set();
  // set of nodes that need to be added to queue next time it is empty
  let toUpdate: Set<Node> = new Set();

  // current group that we are filling up
  let currentGroup: Array<bril.Instruction> = [];
  // total schedule
  let schedule: Array<Array<bril.Instruction>> = [];

  while (true) {
    let node = queue.next();
    if (node && node.instr !== "start") {
      // if we can add node.instr to the currentGroup
      if (valid(currentGroup, node.instr)) {
        currentGroup.push(node.instr);
        scheduled.add(node);
        // check succs for updates next time around
        for (let child of node.succs) {
          if (subset(child.preds, scheduled)) toUpdate.add(child);
        }
      } else {
        // check this node again
        toUpdate.add(node);
      }
    } else { // nothing left in the queue, finalize group and merge toUpdate with queue
      schedule.push(currentGroup);
      for (let item of toUpdate) {
        queue.add(item);
      }
      toUpdate.clear();
      if (queue.isEmpty()) break;
      else currentGroup = [];
    }
  }

  return schedule;
}

export function assignDagPriority(dag: Node): number {
  let maxDepth = 0;
  for (let node of dag.succs) {
    maxDepth = Math.max(maxDepth, assignDagPriority(node));
  }
  dag.priority = maxDepth + 1;
  return maxDepth + 1;
}

export function dataflow(instrs: Array<bril.Instruction>): Node {
  let seen: Map<bril.Ident, Node> = new Map();
  let startNode: Node = {
    succs: new Set(),
    preds: new Set(),
    instr: "start",
    priority: undefined
  };
  for (let instr of instrs) {
    // XXX(sam), what happens if we jump out of the trace?
    if ("dest" in instr) {
      let currNode: Node = {
        succs: new Set(),
        preds: new Set(),
        instr: instr,
        priority: undefined
      };
      if ("args" in instr) {
        for (let arg of instr.args) {
          let parent = seen.get(arg);
          // we have already seen arg, add edges from parent <-> currNode
          if (parent) {
            parent.succs.add(currNode);
            currNode.preds.add(parent);
          }
        }
      }

      // add edge from start -> currNode so that it's feasible to
      // schedule currNode.instr first
      startNode.succs.add(currNode);

      // add currNode to seen
      seen.set(instr.dest, currNode);
    }
  }
  return startNode;
}
