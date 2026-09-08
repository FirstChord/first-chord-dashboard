export default function PlanningSaveError({ message, duplicatePlanningId = '' }) {
  return (
    <span role="alert">
      {message}
      {duplicatePlanningId ? (
        <a
          href={`/admin/planning?focus=${encodeURIComponent(duplicatePlanningId)}`}
          className="ml-2 inline-block font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Open existing card
        </a>
      ) : null}
    </span>
  );
}
