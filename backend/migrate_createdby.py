"""
migrate_createdby.py
--------------------
One-time script: backfills createdBy on root collection documents that lack it.

Usage:
    python migrate_createdby.py <admin_uid>

What it does:
    For each collection in COLLECTIONS, reads every root document.
    Any document missing 'createdBy' gets createdBy set to <admin_uid>.
    Writes are batched (500 per commit — Firestore limit).

After this runs successfully, _fetch_user_collection strategy 3 becomes a no-op
because every legacy document will have createdBy set, and strategy 2 covers them.
"""

import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: python migrate_createdby.py <admin_uid>")
        sys.exit(1)

    uid = sys.argv[1].strip()
    if not uid:
        print("Error: admin_uid cannot be empty")
        sys.exit(1)

    # Initialise Firebase Admin SDK
    import firebase_admin
    from firebase_admin import credentials, firestore

    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    else:
        firebase_admin.initialize_app()  # uses ADC (Application Default Credentials)

    db = firestore.client()

    COLLECTIONS = ["sales", "expenses", "products", "liabilities", "payment_transactions"]
    BATCH_SIZE  = 500

    total_updated = 0

    for col_name in COLLECTIONS:
        print(f"\nScanning /{col_name}...")
        docs_to_update = []

        for doc in db.collection(col_name).stream():
            data = doc.to_dict() or {}
            if "createdBy" not in data:
                docs_to_update.append(doc.reference)

        if not docs_to_update:
            print(f"  ✓ No legacy docs found in /{col_name}")
            continue

        print(f"  → Backfilling {len(docs_to_update)} docs with createdBy={uid}")

        # Write in batches of 500
        for i in range(0, len(docs_to_update), BATCH_SIZE):
            batch = db.batch()
            for ref in docs_to_update[i:i + BATCH_SIZE]:
                batch.update(ref, {"createdBy": uid})
            batch.commit()
            print(f"    Committed batch {i // BATCH_SIZE + 1} "
                  f"({min(i + BATCH_SIZE, len(docs_to_update))}/{len(docs_to_update)})")

        total_updated += len(docs_to_update)
        print(f"  ✓ Done — {len(docs_to_update)} docs updated in /{col_name}")

    print(f"\n✓ Migration complete. {total_updated} documents backfilled across {len(COLLECTIONS)} collections.")
    print("  Strategy 3 in _fetch_user_collection is now a no-op — safe to remove in a future cleanup.")


if __name__ == "__main__":
    main()
