import { ErrorState } from "@/components/error-state";

export default function NotFound() {
  return (
    <ErrorState
      title="Page not found"
      description="The page you requested does not exist."
      primaryHref="/login"
      primaryLabel="Back to login"
    />
  );
}
