# A renter's website, for the Tessera demo.
#
# busybox's own httpd rather than nginx: the provider runs renter images with a
# read-only root filesystem, and nginx wants writable cache and pid paths.
# httpd only ever reads from its document root, so it needs no exceptions.
FROM busybox:1.36

COPY site/ /www/

EXPOSE 8080

# -f keeps it in the foreground so Docker can see it live and signal it;
# -v logs each request, which is what proves the site was really being served.
CMD ["httpd", "-f", "-v", "-p", "8080", "-h", "/www"]
