FROM nginx:1.27-alpine

ENV NGINX_FRONTEND_UPSTREAM=http://frontend:4173 \
    NGINX_BACKEND_UPSTREAM=http://backend:8000

COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
