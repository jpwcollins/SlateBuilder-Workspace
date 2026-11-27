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
          {children}
        </div>
      </body>
    </html>
  );
}
