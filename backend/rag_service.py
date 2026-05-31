import chromadb
from sentence_transformers import SentenceTransformer
import hashlib

print("Loading embedding model...")
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
print("Embedding model loaded!")

# New ChromaDB API (v1.5+)
chroma_client = chromadb.Client()

def get_collection(repo_url: str):
    collection_name = "repo_" + hashlib.md5(repo_url.encode()).hexdigest()[:12]
    try:
        chroma_client.delete_collection(collection_name)
    except:
        pass
    collection = chroma_client.create_collection(collection_name)
    print(f"Created collection: {collection_name}")
    return collection

def store_code_chunks(repo_url: str, code_files: list):
    try:
        collection = get_collection(repo_url)

        documents = []
        metadatas = []
        ids       = []
        chunk_id  = 0

        for file_info in code_files:
            filename = file_info["filename"]
            content  = file_info["content"]

            chunk_size = 500
            chunks = [
                content[i:i+chunk_size]
                for i in range(0, len(content), chunk_size)
            ]

            for chunk in chunks:
                if chunk.strip():
                    documents.append(chunk)
                    metadatas.append({"filename": filename})
                    ids.append(f"chunk_{chunk_id}")
                    chunk_id += 1

        if not documents:
            print("No documents to store")
            return 0

        print(f"Generating embeddings for {len(documents)} chunks...")
        embeddings = embedding_model.encode(documents).tolist()

        collection.add(
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
            ids=ids
        )

        print(f"Stored {len(documents)} chunks in ChromaDB")
        return len(documents)

    except Exception as e:
        print(f"RAG store error: {e}")
        return 0

def search_relevant_chunks(repo_url: str, query: str, top_k: int = 5):
    try:
        collection_name = "repo_" + hashlib.md5(repo_url.encode()).hexdigest()[:12]
        collection = chroma_client.get_collection(collection_name)

        count = collection.count()
        print(f"Collection has {count} chunks")

        if count == 0:
            return ""

        query_embedding = embedding_model.encode([query]).tolist()

        results = collection.query(
            query_embeddings=query_embedding,
            n_results=min(top_k, count)
        )

        if not results["documents"] or not results["documents"][0]:
            return ""

        context = ""
        for i, doc in enumerate(results["documents"][0]):
            filename = results["metadatas"][0][i]["filename"]
            context += f"\n\n--- From {filename} ---\n{doc}"

        print(f"Found {len(results['documents'][0])} relevant chunks")
        return context

    except Exception as e:
        print(f"RAG search error: {e}")
        return ""