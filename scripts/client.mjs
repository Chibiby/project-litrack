// Helper CLI for interacting with runner server
const command = process.argv[2];
const payload = process.argv[3] ? JSON.parse(process.argv[3]) : {};

async function run() {
  const res = await fetch(`http://127.0.0.1:3333/${command}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
