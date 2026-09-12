FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py ontology.py actions.py .
# ontology.yaml は compose でマウントする (編集→再起動で反映)
ENV ONTOLOGY_PATH=/app/ontology.yaml MCP_TRANSPORT=http MCP_PORT=8000
EXPOSE 8000
CMD ["python", "server.py"]
