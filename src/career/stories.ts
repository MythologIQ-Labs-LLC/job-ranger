import { useCallback, useEffect, useState } from "react";
import type { CareerStory, CareerStoryInput } from "../shared/career-stories";
import { getDesktopApi } from "../services/api";

export function useCareerStories() {
  const [stories, setStories] = useState<CareerStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStories(await getDesktopApi().careerStories.list());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load Career Stories",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      setStories(await getDesktopApi().careerStories.list());
      return result;
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to update Career Stories";
      setError(message);
      throw mutationError;
    } finally {
      setBusy(false);
    }
  };

  // A successful canonical DELETE is authoritative. A separate list refresh
  // must not turn that successful irreversible mutation into a false failure.
  const remove = async (storyId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await getDesktopApi().careerStories.delete(storyId);
      setStories((current) => current.filter((story) => story.id !== storyId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete Career Story");
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  return {
    stories,
    loading,
    busy,
    error,
    reload: load,
    create: (input: CareerStoryInput) =>
      runMutation(() => getDesktopApi().careerStories.create(input)),
    update: (storyId: string, input: CareerStoryInput) =>
      runMutation(() => getDesktopApi().careerStories.update(storyId, input)),
    remove,
  };
}
