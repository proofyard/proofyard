"use client";

const DashboardError = ({ error }: { error: Error }) => (
  <p role="alert">dashboard error: {error.message}</p>
);

export default DashboardError;
