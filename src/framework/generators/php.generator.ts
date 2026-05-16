export function generatePhpDockerfile(port: number): string {
  return `FROM php:8.2-apache

# Enable Apache modules
RUN a2enmod rewrite

# Install common PHP extensions
RUN docker-php-ext-install pdo pdo_mysql

# Configure Apache port
RUN sed -i "s/Listen 80/Listen ${port}/" /etc/apache2/ports.conf && \\
    sed -i "s/<VirtualHost \\*:80>/<VirtualHost *:${port}>/" /etc/apache2/sites-available/000-default.conf

COPY . /var/www/html/
RUN chown -R www-data:www-data /var/www/html

EXPOSE ${port}
CMD ["apache2-foreground"]
`;
}
