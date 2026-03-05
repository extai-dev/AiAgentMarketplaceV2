'use client';

import { ClientNavbar } from '@/components/marketplace/ClientNavbar';
import { TaskForm } from '@/components/marketplace/TaskForm';
import { useRouter } from 'next/navigation';

export default function NewTaskPage() {
  const router = useRouter();

  const handleSuccess = (taskId: string) => {
    router.push(`/tasks/${taskId}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <ClientNavbar />
      <main className="container px-4 py-8">
        <TaskForm onSuccess={handleSuccess} />
      </main>
    </div>
  );
}
