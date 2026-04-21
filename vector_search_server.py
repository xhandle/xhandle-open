"""
xHandle: vector search server vector-search service.
This file runs an auxiliary service that stores and queries embedded text chunks for retrieval-style workflows inside xHandle.
The vector service gives AI features a place to persist semantically searchable context outside the main browser application.
Related files: server.js, src/lib/collectCopilotSources.ts, src/components/XHandleCopilotView.jsx.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import chromadb
from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
from dotenv import load_dotenv
load_dotenv()
import os
import openai

token = os.environ.get("VECTORDB_OPENAI_TOKEN")
if not token or not token.startswith("Bearer "):
    raise ValueError("❌ VECTORDB_OPENAI_TOKEN must start with 'Bearer '")

openai.api_key = token.replace("Bearer ", "")

app = Flask(__name__)
CORS(app)

# ✅ New client init pattern
client = chromadb.PersistentClient(path=".chromadb")

# ✅ Collections
collections = {
    "drive_chunks": client.get_or_create_collection(
        name="drive_chunks",
        embedding_function=OpenAIEmbeddingFunction(
            api_key=openai.api_key,
            model_name="text-embedding-3-small"
        )
    ),
    "functional_decomposition_chunks": client.get_or_create_collection(
        name="functional_decomposition_chunks",
        embedding_function=OpenAIEmbeddingFunction(
            api_key=openai.api_key,
            model_name="text-embedding-3-small"
        )
    )
}

@app.route("/api/vector-clear", methods=["DELETE"])
def clear_collection():
    collection_name = request.args.get("collection", "drive_chunks")

    try:
        # Remove from local registry
        if collection_name in collections:
            del collections[collection_name]

        # Delete from disk
        client.delete_collection(collection_name)

        # ✅ Recreate fresh collection immediately
        collections[collection_name] = client.get_or_create_collection(
            name=collection_name,
            embedding_function=OpenAIEmbeddingFunction(
                api_key=openai.api_key,
                model_name="text-embedding-3-small"
            )
        )

        return jsonify({"status": f"Collection '{collection_name}' cleared and recreated"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route("/api/vector-search", methods=["GET"])
def vector_search():
    prompt = request.args.get("prompt")
    collection_name = request.args.get("collection", "drive_chunks")
    if not prompt:
        return jsonify({"error": "Missing prompt parameter"}), 400

    if collection_name not in collections:
        return jsonify({"error": f"Invalid collection name: {collection_name}"}), 400

    try:
        results = collections[collection_name].query(
            query_texts=[prompt],
            n_results=5
        )
        documents = results.get("documents", [[]])[0]
        return jsonify({"chunks": documents})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/vector-ingest", methods=["POST"])
def ingest_chunks():
    data = request.json
    collection_name = request.args.get("collection", "drive_chunks")

    if collection_name not in collections:
        return jsonify({"error": f"Invalid collection name: {collection_name}"}), 400

    if not data or "files" not in data:
        return jsonify({"error": "Missing 'files' in request body"}), 400

    try:
        for file in data["files"]:
            name = file.get("name")
            content = file.get("content")
            if not content:
                continue

            chunks = content.split("\n\n")
            for i, chunk in enumerate(chunks):
                chunk = chunk.strip()
                if chunk:
                    collections[collection_name].add(
                        documents=[chunk],
                        metadatas=[{"file": name, "chunk_index": i}],
                        ids=[f"{collection_name}-{name}-{i}"]
                    )
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5111)