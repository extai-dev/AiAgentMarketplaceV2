import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Task status type
export type TaskStatusType = 'OPEN' | 'IN_PROGRESS' | 'IN_REVIEW' | 'VALIDATING' | 'COMPLETED' | 'DISPUTED' | 'CLOSED' | 'CANCELLED' | 'FAILED';

// Bid status type
export type BidStatusType = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

// Submission status type
export type SubmissionStatusType = 'PENDING' | 'VALIDATING' | 'APPROVED' | 'REJECTED';

// Agent status type
export type AgentStatusType = 'ACTIVE' | 'PAUSED' | 'OFFLINE' | 'ERROR';

// User type
export interface User {
  id: string;
  walletAddress: string;
  email?: string;
  name?: string;
  role: 'user' | 'agent';
  createdAt: string;
}

// Agent criteria type
export interface AgentCriteria {
  minReward?: number;
  maxReward?: number;
  keywords?: string[];
  categories?: string[];
  requireEscrow?: boolean;
  excludeKeywords?: string[];
}

// Agent type
export interface Agent {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  walletAddress: string;
  criteria: AgentCriteria;
  execUrl?: string;
  status: AgentStatusType;
  lastSeen?: string;
  lastError?: string;
  totalDispatches: number;
  totalBids: number;
  acceptedBids: number;
  createdAt: string;
  updatedAt: string;
  owner?: {
    id: string;
    walletAddress: string;
    name?: string;
  };
  isOnline?: boolean;
  apiToken?: string; // Only present when first created
  logs?: Array<{
    id: string;
    action: string;
    message: string;
    level: 'ERROR' | 'WARN' | 'INFO';
    createdAt: string;
  }>;
}

// Task type
export interface Task {
  id: string;
  numericId: number;  // Sequential numeric ID for on-chain use
  title: string;
  description: string;
  reward: number;
  tokenSymbol: string;
  tokenAddress?: string;
  escrowAddress?: string;  // Escrow contract address (for contract versioning)
  status: TaskStatusType;
  creatorId: string;
  agentId?: string;
  onChainId?: number;  // Task ID on blockchain
  escrowDeposited?: boolean;  // Whether escrow has been deposited on-chain
  txHash?: string;
  resultHash?: string;
  multiAgentEnabled?: boolean;
  multiAgentConfig?: string;  // JSON blob with pending execution config
  deadline?: string;
  createdAt: string;
  updatedAt: string;
  creator?: {
    id: string;
    walletAddress: string;
    name?: string;
  };
  agent?: {
    id: string;
    walletAddress: string;
    name?: string;
  };
  bids?: Bid[];
}

// Bid type
export interface Bid {
  id: string;
  taskId: string;
  agentId: string;
  amount: number;
  message?: string;
  status: BidStatusType;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
  agent?: {
    id: string;
    walletAddress: string;
    name?: string;
  };
}

// Store state
interface AppState {
  // User state
  user: User | null;
  setUser: (user: User | null) => void;
  
  // Tasks state
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  
  // Selected task
  selectedTask: Task | null;
  setSelectedTask: (task: Task | null) => void;
  
  // UI state
  isWalletModalOpen: boolean;
  setWalletModalOpen: (open: boolean) => void;
  
  isTaskModalOpen: boolean;
  setTaskModalOpen: (open: boolean) => void;
  
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  
  error: string | null;
  setError: (error: string | null) => void;
  
  // Notifications
  notifications: Array<{
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
    timestamp: number;
  }>;
  addNotification: (notification: Omit<AppState['notifications'][0], 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // User state
      user: null,
      setUser: (user) => set({ user }),
      
      // Tasks state
      tasks: [],
      setTasks: (tasks) => set({ tasks }),
      addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks] })),
      updateTask: (id, updates) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? { ...task, ...updates } : task
          ),
        })),
      
      // Selected task
      selectedTask: null,
      setSelectedTask: (task) => set({ selectedTask: task }),
      
      // UI state
      isWalletModalOpen: false,
      setWalletModalOpen: (open) => set({ isWalletModalOpen: open }),
      
      isTaskModalOpen: false,
      setTaskModalOpen: (open) => set({ isTaskModalOpen: open }),
      
      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),
      
      error: null,
      setError: (error) => set({ error }),
      
      // Notifications
      notifications: [],
      addNotification: (notification) => {
        const id = Math.random().toString(36).substring(7);
        set((state) => ({
          notifications: [
            ...state.notifications,
            { ...notification, id, timestamp: Date.now() },
          ],
        }));
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
          get().removeNotification(id);
        }, 5000);
      },
      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
      clearNotifications: () => set({ notifications: [] }),
    }),
    {
      name: 'ai-task-marketplace',
      partialize: (state) => ({
        user: state.user,
      }),
    }
  )
);
