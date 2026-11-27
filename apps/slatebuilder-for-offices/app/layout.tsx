import "./globals.css";

export const metadata = {
  title: "SlateBuilder for Offices",
  description: "Generate office-level surgical slates and priority waitlists from a local waitlist",
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
