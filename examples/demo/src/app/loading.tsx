export default function Loading() {
  return process.env.NODE_ENV === "development" ? "Loading..." : null;
}
