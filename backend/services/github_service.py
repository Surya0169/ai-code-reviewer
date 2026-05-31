import os
import shutil
from git import Repo

ALLOWED_EXTENSIONS = [
    ".py",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".java",
    ".cpp",
    ".c",
    ".cs",
    ".go",
    ".rs"
]

IGNORE_FOLDERS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "__pycache__",
    "docs",
    "vendor"
]


def clone_repo(repo_url):

    repo_name = repo_url.split("/")[-1]

    local_path = f"repos/{repo_name}"

    if os.path.exists(local_path):
        shutil.rmtree(local_path)

    Repo.clone_from(repo_url, local_path)

    return local_path


def read_code_files(repo_path):

    code_files = []

    for root, dirs, files in os.walk(repo_path):

        dirs[:] = [
            d for d in dirs
            if d not in IGNORE_FOLDERS
        ]

        for file in files:

            if any(file.endswith(ext) for ext in ALLOWED_EXTENSIONS):

                filepath = os.path.join(root, file)

                try:
                    with open(filepath, "r", encoding="utf-8") as f:

                        content = f.read()

                        if len(content.strip()) > 50:

                            code_files.append({
                                "filename": file,
                                "content": content[:6000]
                            })

                except Exception as e:
                    print(f"Error reading file {filepath}: {e}")

    return code_files