#!/usr/bin/env python3
"""Upload local images and videos to a store's Files, then print the theme reference for each.

Usage: python3 scripts/upload-files.py --store acme-store.myshopify.com file1.jpg file2.mp4 ...

Needs a `shopify store auth` session with write_files. Each file goes through
stagedUploadsCreate, a direct upload, then fileCreate, and is polled until READY.
A file that fails is reported and never printed as uploaded.
Output: one JSON line per file, {"local", "status", "ref"}, where ref is the value an
image_picker (shopify://shop_images/<name>) or video (shopify://files/videos/<name>) setting takes.
"""
import argparse, json, mimetypes, os, subprocess, sys, time


def execute(store, query, variables=None, mutation=False):
    cmd = ["shopify", "store", "execute", "--store", store, "--json", "--query", query]
    if variables is not None:
        cmd += ["--variables", json.dumps(variables)]
    if mutation:
        cmd.append("--allow-mutations")
    out = subprocess.run(cmd, capture_output=True, text=True)
    text = out.stdout.strip()
    start = text.find("{")
    if out.returncode != 0 or start < 0:
        raise RuntimeError(f"store execute failed: {out.stderr.strip()[:400] or text[:400]}")
    return json.loads(text[start:])


STAGED = """mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) {
  stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }"""
CREATE = """mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) {
  files { id fileStatus alt } userErrors { field message } } }"""
STATUS = """query($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus image { url } }
  ... on Video { fileStatus filename sources { url } } ... on GenericFile { fileStatus url } } }"""


def upload(store, path, alt):
    name = os.path.basename(path)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    is_video = mime.startswith("video/")
    resource = "VIDEO" if is_video else "IMAGE"
    size = os.path.getsize(path)
    staged = execute(store, STAGED, {"input": [{"filename": name, "mimeType": mime, "resource": resource,
                                                "fileSize": str(size), "httpMethod": "POST"}]}, mutation=True)
    s = staged["stagedUploadsCreate"]
    if s["userErrors"]:
        raise RuntimeError(f"staged upload: {s['userErrors']}")
    t = s["stagedTargets"][0]
    form = []
    for p in t["parameters"]:
        form += ["-F", f"{p['name']}={p['value']}"]
    up = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST", t["url"], *form,
                         "-F", f"file=@{path};type={mime}"], capture_output=True, text=True)
    if not up.stdout.startswith("2"):
        raise RuntimeError(f"upload to staging returned HTTP {up.stdout}")
    created = execute(store, CREATE, {"files": [{"originalSource": t["resourceUrl"], "alt": alt,
                                                  "contentType": resource}]}, mutation=True)
    c = created["fileCreate"]
    if c["userErrors"]:
        raise RuntimeError(f"fileCreate: {c['userErrors']}")
    fid = c["files"][0]["id"]
    for _ in range(60):
        node = execute(store, STATUS, {"id": fid})["node"] or {}
        status = node.get("fileStatus")
        if status == "READY":
            if is_video:
                return fid, "shopify://files/videos/" + (node.get("filename") or name)
            url = (node.get("image") or {}).get("url", "")
            fname = url.split("/files/")[-1].split("?")[0] if "/files/" in url else name
            return fid, "shopify://shop_images/" + fname
        if status == "FAILED":
            raise RuntimeError("Shopify marked the file FAILED")
        time.sleep(3)
    raise RuntimeError("file never became READY (still processing after 3 minutes)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True)
    ap.add_argument("--alts", help="JSON map of basename to alt text", default="{}")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    alts = json.loads(a.alts)
    bad = 0
    for f in a.files:
        try:
            fid, ref = upload(a.store, f, alts.get(os.path.basename(f), ""))
            print(json.dumps({"local": os.path.basename(f), "status": "ok", "id": fid, "ref": ref}), flush=True)
        except Exception as e:
            bad += 1
            print(json.dumps({"local": os.path.basename(f), "status": "FAILED", "error": str(e)[:300]}), flush=True)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
