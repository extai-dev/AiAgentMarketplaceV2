"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Task, TaskStatusType } from "@/store/useStore";
import {
  Clock,
  Coins,
  User,
  MessageSquare,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface TaskCardProps {
  task: Task;
  showActions?: boolean;
}

const statusConfig: Record<
  TaskStatusType,
  { label: string; color: string; icon: React.ReactNode }
> = {
  OPEN: {
    label: "Open",
    color: "bg-blue-500",
    icon: <Clock className="h-3 w-3" />,
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "bg-yellow-500",
    icon: <Loader2 className="h-3 w-3" />,
  },
  COMPLETED: {
    label: "Completed",
    color: "bg-green-500",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  DISPUTED: {
    label: "Disputed",
    color: "bg-red-500",
    icon: <AlertCircle className="h-3 w-3" />,
  },
  CLOSED: {
    label: "Closed",
    color: "bg-gray-500",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "bg-gray-400",
    icon: <XCircle className="h-3 w-3" />,
  },
};

export function TaskCard({ task, showActions = true }: TaskCardProps) {
  const status = statusConfig[task.status];
  const deadline = task.deadline
    ? formatDistanceToNow(new Date(task.deadline), { addSuffix: true })
    : "No deadline";

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg line-clamp-1">
              <Link href={`/tasks/${task.id}`} className="hover:underline">
                {task.title}
              </Link>
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {task.description}
            </CardDescription>
          </div>
          {status && (
            <Badge variant="secondary" className="ml-2 flex items-center gap-1">
              {status.icon}
              {status.label}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {/* Reward */}
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground text-xs">Reward</p>
              <p className="font-medium">
                {task.reward} {task.tokenSymbol}
              </p>
            </div>
          </div>

          {/* Deadline */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground text-xs">Deadline</p>
              <p className="font-medium text-xs">{deadline}</p>
            </div>
          </div>

          {/* Bids */}
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground text-xs">Bids</p>
              <p className="font-medium">{task.bids?.length || 0}</p>
            </div>
          </div>

          {/* Creator */}
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs">
                {task.creator?.name?.[0]?.toUpperCase() ||
                  task.creator?.walletAddress?.slice(1, 3).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-muted-foreground text-xs">Creator</p>
              <p className="font-medium text-xs">
                {task.creator?.name ||
                  `${task.creator?.walletAddress?.slice(0, 6)}...`}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
      {showActions && (
        <CardFooter className="pt-0 gap-2">
          <Button asChild variant="outline" className="flex-1 gap-2">
            <Link href={`/tasks/${task.id}`}>
              View Details
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          {task.status === "OPEN" && (
            <Button asChild className="gap-2">
              <Link href={`/tasks/${task.id}`}>Place Bid</Link>
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
