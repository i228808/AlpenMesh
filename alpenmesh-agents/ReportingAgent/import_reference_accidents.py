import os
import time
import datetime
import base64
from pymongo import MongoClient
import gridfs
from bson import ObjectId

# --- Configuration ---
MONGO_URI = "mongodb://localhost:27017/"
DB_NAME = "alpenmesh"
ACCIDENTS_COLLECTION = "accidents"
IMAGE_DIR = r"D:\FYP\IT2\accident_detection_reference\data\test\Accident"
CAMERA_NAME = "Positive_Videos"

def import_accidents():
    # Connect to MongoDB
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        accidents_col = db[ACCIDENTS_COLLECTION]
        fs = gridfs.GridFS(db)
        # Trigger a connection to check if mongo is up
        client.admin.command('ping')
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        return

    # Check if directory exists
    if not os.path.exists(IMAGE_DIR):
        print(f"Error: Directory not found: {IMAGE_DIR}")
        return

    # List image files
    files = [f for f in os.listdir(IMAGE_DIR) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    print(f"Found {len(files)} images in {IMAGE_DIR}")

    for filename in files:
        filepath = os.path.join(IMAGE_DIR, filename)
        
        try:
            # 1. Read and Store Image in GridFS
            with open(filepath, "rb") as f:
                img_data = f.read()
            
            image_id = fs.put(img_data, filename=filename, content_type="image/jpeg")
            image_id_str = str(image_id)

            # 2. Prepare Metadata (matching the provided sample format)
            now = time.time()
            dt_str = datetime.datetime.fromtimestamp(now).strftime('%Y-%m-%d %H:%M:%S')

            details = {
                "detected_at": now,
                "involved_ids": [49, 82], # Sample IDs
                "iou": 0.21,
                "pred_iou": 0.52,
                "speed_1": 89.3,
                "speed_2": 94.0,
                "accel_1": -150,
                "accel_2": -98.0,
                "location_bbox": [1898.96, 713.43, 2379.31, 847.39], # Sample BBox
                "lanes": [None, None],
                "reasons": [
                    "High IoU at contact (0.21)",
                    "Post-contact motion = accident",
                    f"Ref: {filename}"
                ]
            }

            accident_doc = {
                "type": "accident_alert",
                "camera_name": CAMERA_NAME,
                "timestamp": now,
                "datetime": dt_str,
                "details": details,
                "image_id": image_id_str,
                "received_at": now,
                "status": "open",
                "notes": "Accident at CAMERA_NAME",
                "raw": {
                    "type": "accident_alert",
                    "camera_name": CAMERA_NAME,
                    "timestamp": now,
                    "datetime": dt_str,
                    "details": details,
                    "image_content_type": "image/jpeg"
                }
            }

            # 3. Insert into MongoDB
            res = accidents_col.insert_one(accident_doc)
            print(f"Successfully imported {filename} (ID: {res.inserted_id})")

        except Exception as e:
            print(f"Failed to import {filename}: {e}")

    print("\nBatch import complete.")

if __name__ == "__main__":
    import_accidents()
