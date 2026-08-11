# Getting the site live on blairsbiltong.co.nz

**The plan:** new site goes on the **main domain** (`blairsbiltong.co.nz` +
`www`), on Vercel, from a GitHub repo — same setup as your existing shop.
`shop.blairsbiltong.co.nz` is a separate project and a separate DNS record, so
it keeps taking Stripe orders untouched.

About 20 minutes. No terminal needed — GitHub's website can do the uploading.

---

## Step 1 — Put the files in a GitHub repo (5 min)

1. Go to **[github.com/new](https://github.com/new)**
2. Name it `blairs-biltong`, set it **Private**, don't tick any of the
   "initialize with" boxes
3. **Create repository**
4. On the next screen click **uploading an existing file**
5. Drag in *everything inside* the `blairs-biltong` folder — the files
   themselves, not the folder. GitHub keeps the `assets`, `api` and `test`
   subfolders intact
6. **Commit changes**

You should end up with `index.html` at the top level of the repo, not inside
another folder. If it's nested one deep, Vercel will serve a blank page.

---

## Step 2 — Create the Vercel project (3 min)

1. **[vercel.com/new](https://vercel.com/new)** → **Import Git Repository**
2. Pick `blairs-biltong`
3. Framework Preset: **Other**. Leave build command and output directory empty
4. **Deploy**

A minute later you get a URL like `blairs-biltong.vercel.app`. Open it and
check the site looks right.

Vercel installs the Stripe library automatically from `package.json`, and turns
everything in `/api` into serverless functions. Nothing for you to configure.

---

## Step 3 — Add the domain (2 min)

In the new project: **Settings → Domains → Add**.

Enter `blairsbiltong.co.nz`. Vercel will offer to also add `www` and redirect
one to the other — accept, either direction is fine.

**What happens next depends on how your DNS is set up:**

- **If your nameservers already point at Vercel** (likely, given `shop.` is
  there) — it just works. Vercel adds the records itself, issues the HTTPS
  certificate, and you're done. Skip step 4.

- **If Vercel shows you a record to add** — it'll say something like
  "Set the following record on your DNS provider". That means DNS still lives at
  Crazy Domains. Go to step 4.

---

## Step 4 — Only if Vercel asked for a DNS record

Crazy Domains → **My Account → Domains** → `blairsbiltong.co.nz` →
**DNS Settings**.

> **Read the existing list before touching anything.** Leave the `shop` record
> exactly as it is, and leave any **MX** records alone — those are your email.
> Adding records is safe. Editing the wrong existing one is the only genuinely
> annoying mistake available here.

Add exactly what Vercel told you. It'll be one of:

| Type | Sub Domain | Value |
|---|---|---|
| A Record | *(empty)* | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

Use the values from your Vercel screen rather than these if they differ —
Vercel occasionally changes them.

Save, then go back to Vercel. It'll say "Invalid Configuration" until DNS
propagates, usually 15–60 minutes. The HTTPS certificate issues automatically
once it resolves.

---

## Step 5 — Check, then send it

- **https://blairsbiltong.co.nz** — the new site
- **https://shop.blairsbiltong.co.nz** — should be completely unaffected. Check
  anyway.

Send the first link to your dad.

---

## Making changes from here

Because it's connected to GitHub, **every change you push deploys itself**. Two
ways to make one:

**Small text edits** — easiest. On GitHub, open `index.html`, click the pencil
icon, edit, **Commit changes**. Vercel redeploys in about a minute.

**Anything bigger** — send me the file, I'll make the change, you upload the new
version to GitHub (Add file → Upload files → drop it in → commit).

Vercel keeps every deployment, so if something breaks you can roll back:
**Deployments** → find the last good one → **⋯ → Promote to Production**.

---

## What your dad will be looking at

Worth telling him up front so he doesn't waste notes on things you already know:

- **Testimonials are fake.** Mike, Sarah and Tom came from the mockup. Real ones
  needed before launch.
- **"Our Story" is placeholder copy** I drafted as a starting point. That's
  probably the main thing you want him on.
- **Nutrition panel is empty**, pending analysis.
- **Checkout doesn't work yet** — Add to cart works, paying doesn't.
- **Shipping / Returns / Privacy / FAQ / Contact links go nowhere.**
- **Prices are my $12.50 guess.**

The site is set to **noindex**, so Google won't list it in this state. Anyone
with the link can still see it.

---

## Launch day checklist

1. Delete `robots.txt`
2. Remove the `<meta name="robots" content="noindex, nofollow">` line from
   `index.html` (flagged with a ⚠️ comment near the top)
3. Real testimonials in place of the three fake ones
4. Shipping, returns and privacy pages written
5. Stripe wired up properly — see `STRIPE-SETUP.md`
6. Email signups going somewhere real — see the note at the top of
   `api/subscribe.js`. Right now they only land in the Vercel log

---

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank page on the Vercel URL | Files got nested inside a folder in the repo | `index.html` must be at the top level |
| Images missing | The `assets` folder didn't upload | Check the repo has `assets/` with 4 files |
| "Invalid Configuration" on the domain | DNS hasn't propagated, or a typo | Wait an hour, then re-check the record matches Vercel's screen exactly |
| `shop.` stopped working | Its DNS record got edited | Restore it to what it was, or re-add the domain in the shop's Vercel project |
| Email stopped | MX records changed | Restore them — this is why you don't touch MX |
| Signup form says "Something went wrong" | Expected before deploying | It needs the live site; it can't work from a local file |

---

## Sources

- [Vercel — Adding a custom domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel — Managing DNS records](https://vercel.com/docs/domains/managing-dns-records)
- [Vercel — Functions quickstart](https://vercel.com/docs/functions/quickstart)
- [GitHub — Adding a file to a repository](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
