import { useQuery } from "@tanstack/react-query";

interface DirResult {
  parent: string;
  directories: string[];
}

async function fetchDirectories(path: string): Promise<DirResult> {
  const res = await fetch(`/api/directories?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("Failed to fetch directories");
  return res.json();
}

export function useDirectories(path: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["directories", path],
    queryFn: () => fetchDirectories(path),
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}
