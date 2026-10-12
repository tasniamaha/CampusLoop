export const instant = false;
export default async function Home() {
  const response = await fetch(`${process.env.API_URL}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to connect to the backend');
  }

  const message = await response.text();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">CampusLoop</h1>
      <p>Backend response: {message}</p>
    </main>
  );
}
