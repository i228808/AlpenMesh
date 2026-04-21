import os
from pymongo import MongoClient

MONGO_URI            = os.getenv("MONGO_URI", "mongodb://localhost:27017/alpenmesh")
DB_NAME              = os.getenv("MASTER_DB_NAME", "alpenmesh")
# EdgeAgent scheduler writes to "traffic_metrics"; legacy env var was "edge_metrics"
METRICS_COLLECTION   = os.getenv("METRICS_COLLECTION", "traffic_metrics")
DECISIONS_COLLECTION = os.getenv("DECISIONS_COLLECTION", "master_decisions")

mongo_client     = MongoClient(MONGO_URI)
db               = mongo_client[DB_NAME]
metrics_col      = db[METRICS_COLLECTION]
decisions_col    = db[DECISIONS_COLLECTION]
inter_state_col  = db["intersection_state"]
alerts_col       = db["alerts"]
experience_col   = db["experience"]
