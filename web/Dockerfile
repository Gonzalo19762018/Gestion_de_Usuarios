FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY splash.html /usr/share/nginx/html/index.html
COPY app.html /usr/share/nginx/html/app.html
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/

EXPOSE 80
