# BumpSnap (Rabbit r1 Creation)

Deploy this app to GitHub Pages (free) so Rabbit can load it without your computer running.

## 1) Publish to GitHub

From this folder:

```bash
gh auth login
git init -b main
git add .
git commit -m "Initial BumpSnap app"
gh repo create pregnancy-photo-tracker --public --source=. --remote=origin --push
```

## 2) Enable GitHub Pages

1. Open your repo on GitHub.
2. Go to `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Wait for the `Deploy To GitHub Pages` workflow to finish.

Your app URL will be:

`https://<github-username>.github.io/pregnancy-photo-tracker/`

## 3) Create Rabbit QR Payload

Generate payload + QR automatically:

```bash
./scripts/make-rabbit-qr.sh https://<github-username>.github.io/pregnancy-photo-tracker/
```

This writes:
- `metadata/rabbit-creation-payload.json`
- `metadata/rabbit-r1-creation-install-qr.png`
- `metadata/rabbit-r1-direct-url-qr.png`
