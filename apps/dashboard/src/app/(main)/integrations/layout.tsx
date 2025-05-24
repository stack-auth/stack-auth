
export const metadata = {
  title: "Neon x Stack Auth",
};

export default async function Page(props: { children: React.ReactNode }) {
  return (
    <>
      <style>
        {`
          body {
            color: white;
            background-image: linear-gradient(45deg, #000, #444, #000, #444, #000, #444, #000);
            background-size: 400% 400%;
            background-repeat: no-repeat;
            animation: celebrate-gradient 60s linear infinite;
          }
          @keyframes celebrate-gradient {
            0% { background-position: 0% 100%; }
            100% { background-position: 100% 0%; }
          }
        `}
      </style>
      <div className="flex items-center justify-center min-h-screen">
        {props.children}
      </div>
    </>
  );
}
