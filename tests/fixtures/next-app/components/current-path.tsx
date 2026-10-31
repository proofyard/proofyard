"use client";
import {
  useParams,
  usePathname,
  useSearchParams,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from "next/navigation";

export const CurrentPath = () => {
  const search = useSearchParams().toString();
  return (
    <>
      <p>Path: {usePathname()}</p>
      <p>Search: {search || "(none)"}</p>
      <p>Params: {JSON.stringify(useParams())}</p>
      <p>Segment: {useSelectedLayoutSegment() ?? "(none)"}</p>
      <p>Segments: {useSelectedLayoutSegments().join("/") || "(none)"}</p>
    </>
  );
};
