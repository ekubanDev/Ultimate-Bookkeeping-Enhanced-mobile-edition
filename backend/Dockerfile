FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt || \
    pip install --no-cache-dir $(grep -v emergentintegrations requirements.txt)
RUN pip install --no-cache-dir openai

COPY . .

EXPOSE 8080

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
