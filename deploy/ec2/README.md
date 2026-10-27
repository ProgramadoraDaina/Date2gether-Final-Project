# Date2gether en EC2: entrega académica

La aplicación utiliza LiveKit autohospedado para audio y video, con **6 participantes por llamada** de forma predeterminada. Registro, invitados con nombre, roles y chat siguen en NestJS/Socket.io. La cámara y el micrófono empiezan apagados. El cupo lo aplica LiveKit al conectar: tener un token no reserva un lugar. El chat no aplica todavía un cupo de admisión equivalente.

Una EC2 en **us-east-2** ejecuta frontend, API, PostgreSQL, LiveKit y Caddy con Docker Compose. EC2 está admitido en el plan FREE del nuevo AWS experience; no requiere Chime SDK ni activar funciones avanzadas. El consumo de cómputo, disco, IPv4 y tráfico se descuenta de los créditos según sus condiciones. Verificar saldo y vencimiento en **AWS Settings > Billing**, y región en **AWS Settings > View all projects > Overview > Additional Info > Region**.

Es un despliegue de demostración, con un único host y sin alta disponibilidad. El límite de seis no es una certificación de rendimiento: hay que hacer la prueba real desde varias redes antes de la presentación. Está previsto probar una llamada a la vez, con video adaptativo de hasta 360p en la interfaz; no se garantizan varias salas simultáneas.

## Qué incluye

- `cloudformation.json`: EC2 `t3.medium` (2 vCPU, 4 GiB), disco gp3 cifrado de 30 GiB, IP pública reservada y acceso administrativo por Session Manager. No abre SSH.
- `configure.py`: genera claves aleatorias de JWT, PostgreSQL y LiveKit sobre el servidor. Guarda los archivos en `runtime/` con permisos privados y conserva las claves al volver a ejecutarlo.
- `compose.yaml`: aplicación y medios con versiones fijadas; la imagen de Caddy se fija por digest.
- HTTPS y WebSocket seguro; TURN/UDP y TURN/TLS en 443 para redes restrictivas. La configuración de TURN/SNI sigue la [plantilla oficial de LiveKit](https://github.com/livekit/deploy/blob/main/generate/templates/caddy.go).
- Migraciones de PostgreSQL antes de iniciar la API.
- Apagado automático de EC2 **dos horas después de cada arranque**, mediante un timer de systemd. Los contenedores vuelven a arrancar con EC2.

Solo se exponen TCP 80, 443 y 7881, y UDP 3478 y 7882. Los puertos 3001, 3002, 5432, 7880 y 5349 no se abren en el Security Group. Los puertos públicos de medios son necesarios para invitados en otras redes; TURN exige credenciales temporales del participante.

## Antes de crear la infraestructura

1. La sesión `date2gether` debe estar vigente. Usar `aws login --profile date2gether --region us-east-2` si venció. No pegar contraseñas ni tokens en archivos del repositorio.
2. Confirmar plan, créditos y vencimiento en AWS Settings. El script no cambia el plan; si AWS rechaza un recurso, detenerse y revisar el motivo.
3. Tener una VPC y una subred **pública en us-east-2**, con ruta `0.0.0.0/0` a un Internet Gateway. Si existe una VPC por defecto, puede servir para esta demo. La subred y la VPC tienen que corresponderse.
4. Elegir DNS: un dominio propio es la opción más estable. Apuntar `app.<dominio>`, `media.<dominio>` y `turn.<dominio>` a la IP de la salida del stack. Si se omite el dominio, se genera `<servicio>.<IP>.sslip.io`, una alternativa temporal sin registro para la entrega. Depende de un DNS externo y de la emisión pública de certificados; puede tener límites de disponibilidad o de Let's Encrypt. Si falla, configurar un dominio propio y revisar DNS. No se usan certificados autofirmados ni se desactiva la verificación TLS.
5. Confirmar que el código revisado está **commiteado y pusheado**, y que el repositorio indicado es público. La instancia descarga el commit exacto indicado por `GitRef`. No colocar un token GitHub en la URL ni en UserData; un repositorio privado necesita otro mecanismo de distribución.

## Crear el stack

El siguiente comando crea recursos y comienza a consumir créditos. Revisar el costo antes de ejecutarlo. Reemplazar únicamente los identificadores por los de la VPC y la subred elegidas:

```bash
bash deploy/ec2/deploy.sh vpc-XXXXXXXX subnet-XXXXXXXX
```

Con dominio propio:

```bash
bash deploy/ec2/deploy.sh vpc-XXXXXXXX subnet-XXXXXXXX entrega.ejemplo.com
```

El script fija `us-east-2`, el nombre `date2gether-demo`, seis participantes y el SHA actual. CloudFormation solicita `CAPABILITY_IAM` porque crea un rol de EC2 con `AmazonSSMManagedInstanceCore`; ese rol no concede permisos administrativos a la aplicación.

Que el stack termine no significa que la aplicación haya terminado de compilar. Revisar las salidas del stack y abrir la instancia desde **EC2 > Instances > Connect > Session Manager**. En esa terminal:

```bash
sudo cloud-init status --wait
sudo tail -n 80 /var/log/cloud-init-output.log
sudo docker compose -f /opt/date2gether/deploy/ec2/compose.yaml ps
```

No compartir logs que incluyan datos de usuarios, nombres de sala o tokens. `configure.py` no imprime secretos. Si hay dominio propio, esperar a que los tres registros DNS resuelvan a la IP antes de exigir que HTTPS responda.

Abrir `ApplicationUrl` por **HTTPS**. Crear una cuenta, crear una sala, copiar el enlace y abrirlo en otro dispositivo. El invitado solo confirma un nombre. Cada persona pulsa Llamar y activa sus dispositivos desde los controles. Se puede participar escuchando sin otorgar permisos de cámara o micrófono.

## Prueba de la entrega

- Dos dispositivos, idealmente Wi-Fi y datos móviles; usar auriculares para evitar acople.
- Invitados sin cuenta y nombres repetidos conservan identidades distintas; los nombres vienen del pase verificado.
- Activar cámara y micrófono, cambiar el dispositivo con los menús, apagarlos y comprobar que los demás dejan de recibir el medio.
- Rechazar permisos y continuar escuchando o usando el chat; los errores de dispositivos no deben cerrar la llamada.
- Colgar o salir de la página libera cámara y micrófono. Volver a llamar permite reconectar.
- Con seis personas conectadas a medios, rechazar la séptima; al colgar una, otra puede entrar. Los clientes con token emitido previamente tampoco eluden el cupo.
- Probar recuperación de un corte breve de red y audio en un navegador que requiere pulsar Activar sonido de la reunión.
- Mantener una llamada de 60 minutos para la entrega. Registrar equipos, redes y resultado; las pruebas automáticas no acreditan esta prueba real.

## Arrancar y detener

Desde AWS Console se puede iniciar o detener la EC2. Su IP reservada se mantiene y los servicios arrancan automáticamente. No eliminar volúmenes Docker para detenerla. El timer de apagado se consulta en la instancia:

```bash
sudo systemctl status date2gether-autostop.timer
```

Si se necesita más tiempo para una presentación, desactivar temporalmente el timer desde esa terminal y volver a habilitarlo al terminar. El apagado interrumpe las llamadas activas.

## Costos y créditos

LiveKit autohospedado no consume minutos de LiveKit Cloud ni cobra licencia del servidor. AWS cobra la infraestructura. La licencia y el plan gratuito de seis meses no garantizan que 100 USD cubran seis meses de un servidor encendido todo el tiempo.

Hay cuatro componentes: horas de EC2, almacenamiento gp3, IPv4 reservada y transferencia de salida. La [tarifa pública de IPv4](https://aws.amazon.com/vpc/pricing/) es **0,005 USD/h** tanto en uso como reservada sin uso. Por tanto, detener la EC2 corta el cómputo, pero el disco y la IP siguen consumiendo recursos. Verificar los precios de Ohio y los créditos en el [AWS Pricing Calculator](https://calculator.aws/) y en Billing antes de crear el stack. No se pudo obtener una cotización autenticada durante la preparación porque la sesión AWS previa requería renovación.

La plantilla usa CPU en modo `standard`, que evita cargos por créditos de CPU excedentes de las T3 a costa de reducir el rendimiento si se agotan. No crea NAT Gateway, balanceador administrado, RDS ni grabación en la nube. El primer arranque descarga dependencias y construye las imágenes; conviene hacerlo antes de la presentación.

## Copias, actualización y retiro

En la terminal de la instancia, crear una copia privada de PostgreSQL antes de actualizar:

```bash
sudo install -d -m 700 /opt/date2gether/deploy/ec2/backups
sudo sh -c 'umask 077; docker compose -f /opt/date2gether/deploy/ec2/compose.yaml exec -T postgres pg_dump -U date2gether date2gether > /opt/date2gether/deploy/ec2/backups/date2gether.sql'
```

La copia queda en el mismo disco; copiarla a un lugar privado fuera de la instancia si se necesita protección ante pérdida del host. No subirla al repositorio. Actualizar explícitamente al nuevo commit revisado y ejecutar `sudo bash deploy/ec2/start.sh`. Las claves y volúmenes se conservan; no usar `docker compose down -v` para actualizar.

Al terminar la entrega, decidir si se conservarán los recursos o se retirarán. Borrar el stack elimina la EC2, el rol, las reglas y la IP reservada; **el disco raíz se conserva por seguridad**, para no borrar cuentas y mensajes sin una decisión explícita. Sigue teniendo costo hasta eliminarlo. Hacer una copia, confirmar qué volumen pertenece a esta demo y eliminarlo desde EBS si sus datos ya no se necesitan. Una instantánea conservada también tiene costo.

## Validaciones locales

Se pueden comprobar tipos, pruebas y configuración sin iniciar servidores públicos:

```bash
pnpm test --runInBand
pnpm test:client --runInBand
pnpm check:client
pnpm build
uvx --from cfn-lint==1.58.0 cfn-lint deploy/ec2/cloudformation.json --regions us-east-2
```

La validación local de la plantilla no comprueba permisos, cuotas, saldo, DNS ni disponibilidad real de EC2. El último paso es desplegar y completar la prueba entre dispositivos.

### Estado verificado el 27 de octubre de 2026

- Backend: 22 pruebas aprobadas y tipos válidos; imagen Docker construida con Node 22.
- Cliente: 21 pruebas aprobadas, tipos válidos y build de producción dentro de Docker con `NEXT_PUBLIC_API_URL=/api`.
- Plantilla: `cfn-lint 1.58.0` sin errores en `us-east-2`.
- Caddy: configuración HTTPS/TURN aceptada por la imagen oficial mediante `caddy validate` en un contenedor aislado, sin puertos publicados.
- LiveKit: configuración aceptada al enumerar los puertos del servidor oficial 1.13.11.
- Generador: archivos privados 0600, claves conservadas al reejecutar y configuración del cupo y TURN verificada.
- Pendiente: sesión AWS vigente, comprobaciones autenticadas de plan/cuotas/precio, despliegue, certificados reales y prueba de audio/video entre dispositivos. No se crearon recursos AWS durante estas comprobaciones.
