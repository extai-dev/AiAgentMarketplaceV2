// TaskEscrow Contract ABI for viem/wagmi (Gas Optimized Version)
// Key changes from original:
// - Task struct uses uint40 for timestamps (deadline, createdAt, completedAt)
// - resultHash removed from Task struct (now emitted in TaskResultSubmitted event)
// - createTask accepts uint40 deadline

export const TASK_ESCROW_ABI = [
  // Read functions
  {
    inputs: [{ name: "_taskId", type: "uint256" }],
    name: "getTask",
    outputs: [{
      components: [
        { name: "id", type: "uint256" },
        { name: "creator", type: "address" },
        { name: "assignedAgent", type: "address" },
        { name: "reward", type: "uint256" },
        { name: "deadline", type: "uint40" },
        { name: "status", type: "uint8" },
        { name: "createdAt", type: "uint40" },
        { name: "completedAt", type: "uint40" },
        { name: "title", type: "string" },
        { name: "description", type: "string" }
        // Note: resultHash removed - now emitted in TaskResultSubmitted event
      ],
      name: "",
      type: "tuple"
    }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "taskCounter",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "_taskId", type: "uint256" }],
    name: "getTaskBids",
    outputs: [{
      components: [
        { name: "id", type: "uint256" },
        { name: "taskId", type: "uint256" },
        { name: "agent", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "status", type: "uint8" },
        { name: "createdAt", type: "uint40" },
        { name: "message", type: "string" }
      ],
      name: "",
      type: "tuple[]"
    }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "_creator", type: "address" }],
    name: "getCreatorTasks",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "_agent", type: "address" }],
    name: "getAgentTasks",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "deposits",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "paymentToken",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  // Write functions
  {
    inputs: [
      { name: "_title", type: "string" },
      { name: "_description", type: "string" },
      { name: "_reward", type: "uint256" },
      { name: "_deadline", type: "uint40" }  // Changed from uint256 to uint40
    ],
    name: "createTask",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "_taskId", type: "uint256" },
      { name: "_amount", type: "uint256" }
    ],
    name: "depositEscrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "_taskId", type: "uint256" },
      { name: "_amount", type: "uint256" },
      { name: "_message", type: "string" }
    ],
    name: "submitBid",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "_bidId", type: "uint256" }],
    name: "acceptBid",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "_bidId", type: "uint256" }],
    name: "rejectBid",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "_taskId", type: "uint256" },
      { name: "_resultHash", type: "string" }
    ],
    name: "completeTask",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "_taskId", type: "uint256" }],
    name: "approveAndRelease",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "_taskId", type: "uint256" }],
    name: "cancelTask",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "_taskId", type: "uint256" }],
    name: "raiseDispute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "taskId", type: "uint256" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "reward", type: "uint256" },
      { indexed: false, name: "title", type: "string" },
      { indexed: false, name: "deadline", type: "uint40" }
    ],
    name: "TaskCreated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "taskId", type: "uint256" },
      { indexed: false, name: "newStatus", type: "uint8" }
    ],
    name: "TaskUpdated",
    type: "event"
  },
  {
    // NEW: TaskResultSubmitted event - resultHash is now emitted here instead of stored
    anonymous: false,
    inputs: [
      { indexed: true, name: "taskId", type: "uint256" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: false, name: "resultHash", type: "string" }
    ],
    name: "TaskResultSubmitted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "bidId", type: "uint256" },
      { indexed: true, name: "taskId", type: "uint256" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "message", type: "string" }
    ],
    name: "BidSubmitted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "taskId", type: "uint256" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: false, name: "amount", type: "uint256" }
    ],
    name: "PaymentReleased",
    type: "event"
  }
] as const;
