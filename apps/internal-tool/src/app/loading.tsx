export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
        <p className="text-sm">Loading...</p>
      </div>
    </div>
  );
}
