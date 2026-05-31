
import chromadb
from sentence_transformers import SentenceTransformer

# Initialize ChromaDB and embedding model
chroma_client = chromadb.Client()
embedder = SentenceTransformer("all-MiniLM-L6-v2")

def store_repo_embeddings(repo_url: str, code_chunks: list):
    collection_name = repo_url.replace("/", "_").replace(":", "_")[-60:]
    try:
        chroma_client.delete_collection(collection_name)
    except:
        pass
    collection = chroma_client.create_collection(collection_name)
    embeddings = embedder.encode(code_chunks).tolist()
    collection.add(
        documents=code_chunks,
        embeddings=embeddings,
        ids=[f"chunk_{i}" for i in range(len(code_chunks))]
    )
    return collection

def query_similar_chunks(repo_url: str, question: str, n_results: int = 5) -> str:
    collection_name = repo_url.replace("/", "_").replace(":", "_")[-60:]
    try:
        collection = chroma_client.get_collection(collection_name)
        query_embedding = embedder.encode([question]).tolist()
        results = collection.query(query_embeddings=query_embedding, n_results=n_results)
        return "\n\n".join(results["documents"][0])
    except:
        return ""
