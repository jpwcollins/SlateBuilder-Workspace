import "./globals.css";

export const metadata = {
  title: "SlateBuilder Pro",
  description: "Generate optimized surgical slates from waiting lists",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="relative min-h-screen bg-sand-50">
          <div className="pointer-events-none absolute inset-0 gridline" />
          <div className="pointer-events-none absolute -top-32 right-0 h-80 w-80 rounded-full bg-slateBlue-200/60 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-0 h-96 w-96 rounded-full bg-sand-300/60 blur-3xl" />
          {children}
        </div>
      </body>
    </html>
  );
}
