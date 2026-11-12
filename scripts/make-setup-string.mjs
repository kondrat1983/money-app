// Prints the one-time setup string for the app. Usage: node scripts/make-setup-string.mjs <execUrl> <token>
// Paste the output into Settings on the phone. Nothing is stored; keep the values out of the repo.
const [url, token] = process.argv.slice(2)
if (!url || !token) {
  console.error('usage: node scripts/make-setup-string.mjs <execUrl> <token>')
  process.exit(1)
}
console.log('youspent1.' + Buffer.from(JSON.stringify({ u: url, t: token })).toString('base64url'))
