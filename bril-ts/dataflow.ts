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
    return t1.priority < t2.priority;
  }
  return t1.priority !== undefined;
}

/**
 * Given a sequence of instructions, generate a group with pre-condition tests
 * extracted out from the function.
 */
function toGroup(trace: bril.Instruction[]): bril.Group {
  let conds: bril.Ident[] = [];
  let instrs: (bril.ValueOperation | bril.Constant)[] = [];
  let failLabel: bril.Ident = "";

  // Calculate set of pre conditions for trace
  for (let instr of trace) {
    if ('conds' in instr) throw `Cannot nest groups`;
    if (instr.op === 'trace') {
      switch (instr.effect.op) {
        case "br":
          conds.push(instr.effect.args[0]);
          break;
      }
      failLabel = instr.failLabel;
    } else if ('dest' in instr) {
      instrs.push(instr)
    }

    // let condArgs: Set<b.Ident> = new Set();
    // // If an Effect Operation, add the arguments to set of condArgs
    // if (!('dest' in inst)) {
    //   inst.args.forEach(a => condArgs.add(a));
    // } else if (inst.op != 'const' && condArgs.has(inst.dest)) {
    //   conds.push(inst);
    // } else {
    //   instrs.push(inst);
    // }
  }

  return { conds, instrs, failLabel }
}


export function listSchedule(
  dag: Node,
  valid: (instrs: Array<bril.Instruction>, cand: bril.Instruction) => boolean
): bril.Group[] {
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
  let currentGroup: bril.Instruction[] = [];
  // total schedule
  let schedule: bril.Group[] = [];

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
      schedule.push(toGroup(currentGroup));
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
  let written: Map<bril.Ident, Node> = new Map();
  let read: Map<bril.Ident, Set<Node>> = new Map();

  function addRead(ident: bril.Ident, node: Node) {
    let val = read.get(ident);
    if (!val) {
      val = new Set();
      read.set(ident, val);
    }
    val.add(node);
  }

  let startNode: Node = {
    succs: new Set(),
    preds: new Set(),
    instr: "start",
    priority: undefined
  };
  for (let instr of instrs) {
    // XXX(sam), what happens if we jump out of the trace?
    let currNode: Node = {
      succs: new Set(),
      preds: new Set(),
      instr: instr,
      priority: undefined
    };

    // add edge from start -> currNode so that it's feasible to
    // schedule currNode.instr first
    startNode.succs.add(currNode);

    if ("dest" in instr) {
      // add edges from writes in this instr to prev reads
      let parent = read.get(instr.dest);
      if (parent) {
        for (let node of parent) {
          node.succs.add(currNode);
          currNode.preds.add(node);
        }
      }

      // add currNode to seen
      written.set(instr.dest, currNode);
    }

    // add edges from reads in this instr to prev writes
    if ("args" in instr) {
      for (let arg of instr.args) {
        let parent = written.get(arg);
        // we have already seen arg, add edges from parent <-> currNode
        if (parent) {
          parent.succs.add(currNode);
          currNode.preds.add(parent);
        }
        // add arg to read map
        addRead(arg, currNode);
      }
    }
  }
  return startNode;
}
