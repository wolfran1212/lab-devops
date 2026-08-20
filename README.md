# 🚀 CI/CD con GitHub Actions y Google Cloud Run

Pipeline de despliegue automático de una aplicación Node.js/Express hacia Google Cloud Run, usando Workload Identity Federation para autenticación sin claves secretas.

---

## 📋 Tabla de contenido

- [Arquitectura](#arquitectura)
- [Prerequisitos](#prerequisitos)
- [Paso 1 — Configurar Google Cloud CLI](#paso-1--configurar-google-cloud-cli)
- [Paso 2 — Habilitar APIs](#paso-2--habilitar-apis)
- [Paso 3 — Crear Artifact Registry](#paso-3--crear-artifact-registry)
- [Paso 4 — Crear Service Account y permisos](#paso-4--crear-service-account-y-permisos)
- [Paso 5 — Configurar Workload Identity Federation](#paso-5--configurar-workload-identity-federation)
- [Paso 6 — Secretos en GitHub](#paso-6--secretos-en-github)
- [Paso 7 — Estructura del repositorio](#paso-7--estructura-del-repositorio)
- [Paso 8 — Workflow de GitHub Actions](#paso-8--workflow-de-github-actions)
- [Paso 9 — Verificar el despliegue](#paso-9--verificar-el-despliegue)
- [Brechas de seguridad conocidas](#brechas-de-seguridad-conocidas)

---

## Arquitectura

```
git push (main)
      │
      ▼
GitHub Actions (ubuntu-latest)
      │
      ├─ 1. Checkout código
      ├─ 2. Auth → Google Cloud (Workload Identity OIDC)
      ├─ 3. Login Docker → Artifact Registry
      ├─ 4. docker build & push (taggeado con commit SHA)
      └─ 5. gcloud run deploy → Cloud Run
                                      │
                                      ▼
                              Servicio en vivo (HTTPS)
```

**Stack:**

- **Aplicación:** Node.js + Express
- **Contenedor:** Docker
- **Registro de imágenes:** Google Artifact Registry
- **Plataforma:** Google Cloud Run (serverless)
- **CI/CD:** GitHub Actions
- **Autenticación:** Workload Identity Federation (sin claves JSON)

---

## Prerequisitos

- Cuenta de Google Cloud con proyecto activo
- Cuenta de GitHub con repositorio creado
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) instalado
- Docker instalado localmente (opcional, para pruebas locales)

---

## Paso 1 — Configurar Google Cloud CLI

Instala gcloud CLI desde https://cloud.google.com/sdk/docs/install y luego inicializa:

```cmd
gcloud init
```

Verifica que el proyecto correcto esté activo:

```cmd
gcloud config set project banded-water-506101-p8
gcloud config list
```

---

## Paso 2 — Habilitar APIs

```cmd
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com
```

---

## Paso 3 — Crear Artifact Registry

Repositorio Docker donde se almacenarán las imágenes:

```cmd
gcloud artifacts repositories create mi-app --repository-format=docker --location=us-central1
```

Verifica que quedó creado:

```cmd
gcloud artifacts repositories list
```

---

## Paso 4 — Crear Service Account y permisos

**Crear el Service Account:**

```cmd
gcloud iam service-accounts create github-actions-sa --display-name="GitHub Actions SA"
```

**Permiso para desplegar en Cloud Run:**

```cmd
gcloud projects add-iam-policy-binding banded-water-506101-p8 --member="serviceAccount:github-actions-sa@banded-water-506101-p8.iam.gserviceaccount.com" --role="roles/run.admin"
```

**Permiso para subir imágenes a Artifact Registry:**

```cmd
gcloud projects add-iam-policy-binding banded-water-506101-p8 --member="serviceAccount:github-actions-sa@banded-water-506101-p8.iam.gserviceaccount.com" --role="roles/artifactregistry.writer"
```

**Permiso para actuar como Service Account:**

```cmd
gcloud projects add-iam-policy-binding banded-water-506101-p8 --member="serviceAccount:github-actions-sa@banded-water-506101-p8.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser"
```

---

## Paso 5 — Configurar Workload Identity Federation

Permite que GitHub Actions se autentique con Google Cloud sin necesidad de claves JSON.

**Obtener el número del proyecto:**

```cmd
gcloud projects describe banded-water-506101-p8 --format="value(projectNumber)"
```

**Crear el Identity Pool:**

```cmd
gcloud iam workload-identity-pools create "github-pool" --location="global" --display-name="GitHub Pool"
```

**Crear el Provider:**

```cmd
gcloud iam workload-identity-pools providers create-oidc "github-provider" --location="global" --workload-identity-pool="github-pool" --display-name="GitHub Provider" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" --attribute-condition="assertion.repository_owner=='wolfran1212'" --issuer-uri="https://token.actions.githubusercontent.com"
```

**Vincular el Service Account al pool:**

```cmd
gcloud iam service-accounts add-iam-policy-binding github-actions-sa@banded-water-506101-p8.iam.gserviceaccount.com --role="roles/iam.workloadIdentityUser" --member="principalSet://iam.googleapis.com/projects/814108920481/locations/global/workloadIdentityPools/github-pool/attribute.repository_owner/wolfran1212"
```

**Obtener el nombre completo del provider** (necesario como secreto en GitHub):

```cmd
gcloud iam workload-identity-pools providers describe github-provider --location="global" --workload-identity-pool="github-pool" --format="value(name)"
```

El valor será algo como:

```
projects/814108920481/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

---

## Paso 6 — Secretos en GitHub

Ve a tu repositorio → **Settings → Secrets and variables → Actions → New repository secret** y agrega:

| Nombre                | Valor                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`      | `banded-water-506101-p8`                                                                             |
| `WIF_PROVIDER`        | `projects/814108920481/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `WIF_SERVICE_ACCOUNT` | `github-actions-sa@banded-water-506101-p8.iam.gserviceaccount.com`                                   |

---

## Paso 7 — Estructura del repositorio

```
📁 tu-repositorio/
├── 📁 .github/
│   └── 📁 workflows/
│       └── 📄 deploy.yml
├── 📄 app.js
├── 📄 package.json
└── 📄 Dockerfile
```

**app.js:**

```javascript
const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("Hola desde Cloud Run 🚀");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
```

**package.json:**

```json
{
  "name": "mi-app",
  "version": "1.0.0",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

**Dockerfile:**

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --only=production

COPY . .

EXPOSE 8080

CMD ["node", "app.js"]
```

> **Importante:** Cloud Run requiere que la app escuche en el puerto `8080` y en `0.0.0.0`, no solo en `localhost`.

---

## Paso 8 — Workflow de GitHub Actions

Archivo `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: us-central1
  SERVICE_NAME: mi-app
  IMAGE: us-central1-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/mi-app/mi-app

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # requerido para Workload Identity Federation

    steps:
      - name: Checkout código
        uses: actions/checkout@v4

      - name: Autenticar con Google Cloud
        id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
          token_format: access_token

      - name: Configurar gcloud
        uses: google-github-actions/setup-gcloud@v2

      - name: Login a Artifact Registry
        uses: docker/login-action@v3
        with:
          registry: us-central1-docker.pkg.dev
          username: oauth2accesstoken
          password: ${{ steps.auth.outputs.access_token }}

      - name: Build y push imagen Docker
        run: |
          docker build -t ${{ env.IMAGE }}:${{ github.sha }} .
          docker push ${{ env.IMAGE }}:${{ github.sha }}

      - name: Deploy a Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.SERVICE_NAME }}
          region: ${{ env.REGION }}
          image: ${{ env.IMAGE }}:${{ github.sha }}
```

---

## Paso 9 — Verificar el despliegue

Haz push a `main` y ve a la pestaña **Actions** en GitHub para ver el pipeline en tiempo real.

Una vez verde, obtén la URL del servicio:

```cmd
gcloud run services describe mi-app --region=us-central1 --project=banded-water-506101-p8 --format="value(status.url)"
```

Si recibes error `403`, habilita el acceso público:

```cmd
gcloud run services add-iam-policy-binding mi-app --region=us-central1 --project=banded-water-506101-p8 --member="allUsers" --role="roles/run.invoker"
```

Abre la URL en el navegador y deberías ver:

```
Hola desde Cloud Run 🚀
```

Ver logs del servicio:

```cmd
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=mi-app" --limit=20 --project=banded-water-506101-p8 --format="value(textPayload)"
```

---

## Brechas de seguridad conocidas

| #   | Brecha                                          | Riesgo                                      | Solución recomendada                                                                   |
| --- | ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Pool abierto a toda la cuenta GitHub            | Cualquier repo puede usar las credenciales  | Restringir a un repo específico con `assertion.repository=='wolfran1212/cicdtraining'` |
| 2   | Servicio público sin autenticación (`allUsers`) | Abuso de recursos y costos inesperados      | Agregar rate limiting o usar Cloud Armor                                               |
| 3   | Service Account con `roles/run.admin`           | Permisos excesivos sobre Cloud Run          | Cambiar a `roles/run.developer`                                                        |
| 4   | Sin escaneo de vulnerabilidades en la imagen    | Imágenes con CVEs desplegadas en producción | Agregar `google-github-actions/scan-docker-image` al workflow                          |
| 5   | Sin protección en rama `main`                   | Cualquier push va directo a producción      | Habilitar branch protection con Pull Request obligatorio                               |

---

## Referencias

- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [google-github-actions/auth](https://github.com/google-github-actions/auth)
- [google-github-actions/deploy-cloudrun](https://github.com/google-github-actions/deploy-cloudrun)

---

_Universidad de Boyacá • 2026 • github.com/wolfran1212_
