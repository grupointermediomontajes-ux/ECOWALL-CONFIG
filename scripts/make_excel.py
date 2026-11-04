"""Genera data/precios.xlsx (plantilla de tarifas de ECOWALL).
Solo hace falta ejecutarlo si quieres regenerar la plantilla desde cero."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, Protection
from openpyxl.worksheet.datavalidation import DataValidation

BLANCO = 'Blanco (sin imprimir)'
UNICO = None   # objetos extras: sin acabado, la columna queda vacía
# (código interno, nombre en la app, dimensiones, [(clave, texto, precio por defecto)])
ITEMS = [
 ('muro','PARED UNIVERSAL','500 x 300 x 2400 mm',[('unpainted',BLANCO,35),('painted_1','Impreso 1 cara',55),('painted_2','Impreso 2 caras',80)]),
 ('muro1c','PANEL UNIVERSAL 1C','500 x 300 x 2400 mm',[('unpainted',BLANCO,20),('painted','Impreso',40)]),
 ('esquina','ESQUINA 90º','300 x 300 x 2400 mm',[('unpainted',BLANCO,20),('painted','Impreso',40)]),
 ('esquina45','ESQUINA 45º','650 x 650 x 2400 mm',[('unpainted',BLANCO,20),('painted','Impreso',40)]),
 ('pico','PANEL PICO','350 x 480 x 2400 mm',[('unpainted',BLANCO,20),('painted_1','Impreso 1 cara',40),('painted_2','Impreso 2 caras',80)]),
 ('picodoble','PANEL PICO DOBLE','350 x 660 x 2400 mm',[('unpainted',BLANCO,40),('painted','Impreso',80)]),
 ('mostrador','MOSTRADOR 2M','1000 x 300 x 1000h mm',[('unpainted',BLANCO,0),('painted','Impreso',0)]),
 ('mostrador1m','MOSTRADOR 1M','500 x 300 x 1000h mm',[('unpainted',BLANCO,0),('painted','Impreso',0)]),
 ('focoPala','FOCO PALA','200 x 300 x 120 mm',[('unpainted',UNICO,0)]),
 ('tvSoporte','TV CON SOPORTE','1250 x 340 mm',[('unpainted',UNICO,0)]),
 ('mesaSillas','MESA BAJA-4SILLAS','1300 x 1300 mm',[('unpainted',UNICO,0)]),
 ('mesaAlta','MESA ALTA-2 tab.','1200 x 550 mm',[('unpainted',UNICO,0)]),
 ('portaCatalogos','PORTACATALOGOS','280 x 280 mm',[('unpainted',UNICO,0)]),
 ('lateral','PARED FINAL','300 x 50 x 2400 mm',[('unpainted',BLANCO,20),('painted','Impreso',35)]),
]
F='Arial'
f_norm=Font(name=F,size=10); f_bold=Font(name=F,size=10,bold=True)
f_title=Font(name=F,size=16,bold=True,color='1F2937'); f_head=Font(name=F,size=10,bold=True,color='FFFFFF')
f_in=Font(name=F,size=11,bold=True,color='0000FF'); f_key=Font(name=F,size=8,color='9CA3AF')
f_note=Font(name=F,size=9,italic=True,color='6B7280')
fill_head=PatternFill('solid',fgColor='1F2937'); fill_in=PatternFill('solid',fgColor='FFFF99')
fill_sec=PatternFill('solid',fgColor='E0E7FF'); fill_alt=PatternFill('solid',fgColor='F3F4F6')
thin=Side(style='thin',color='D1D5DB'); box=Border(left=thin,right=thin,top=thin,bottom=thin)

wb=Workbook(); ws=wb.active; ws.title='Precios'
ws.sheet_view.showGridLines=False
for col,w in zip('ABCDEF',[6,26,30,24,16,20]): ws.column_dimensions[col].width=w

ws['A1']='ECOWALL · TARIFA DE PRECIOS'; ws['A1'].font=f_title
ws['A2']='Edita SOLO las celdas amarillas (columna «Precio (€)»). Un precio vacío o a 0 se cuenta como 0 €.'
ws['A3']='Guarda el archivo, ciérralo y pulsa «Recargar precios» en la aplicación. No hace falta recompilar nada.'
ws['A4']='La columna «Clave interna» la usa la aplicación para localizar cada precio: no la modifiques.'
for r in (2,3,4): ws[f'A{r}'].font=f_note
ws.row_dimensions[1].height=26

HR=6
for c,t in zip('ABCDEF',['Nº','Pieza','Acabado / opción','Dimensiones','Precio (€)','Clave interna']):
    cell=ws[f'{c}{HR}']; cell.value=t; cell.font=f_head; cell.fill=fill_head; cell.border=box
    cell.alignment=Alignment(horizontal='center' if c in 'AEF' else 'left',vertical='center')
ws.row_dimensions[HR].height=22

r=HR+1; n=0; first=r; band=False
for code,name,dims,opts in ITEMS:
    n+=1; band=not band
    for key,txt,price in opts:
        vals=[n,name,txt,dims,price,f'{code}:{key}']
        for c,v in zip('ABCDEF',vals):
            cell=ws[f'{c}{r}']; cell.value=v; cell.border=box; cell.font=f_norm
            cell.alignment=Alignment(horizontal='center' if c in 'AF' else 'left',vertical='center')
            if band and c!='E': cell.fill=fill_alt
        ws[f'F{r}'].font=f_key
        e=ws[f'E{r}']; e.number_format='#,##0.00 "€"'; e.fill=fill_in; e.font=f_in
        e.alignment=Alignment(horizontal='right'); e.protection=Protection(locked=False)
        r+=1
last=r-1

# ---- parámetros generales (al final) ----
r+=1
ws[f'A{r}']='PARÁMETROS GENERALES'
for c in 'ABCDEF':
    ws[f'{c}{r}'].fill=fill_sec; ws[f'{c}{r}'].font=f_bold; ws[f'{c}{r}'].border=box
r+=1; floor_row=r
rows=[('Moqueta ferial','Precio por m² de suelo','—',4.5,'SUELO_M2','#,##0.00 "€/m²"'),
      ('BENEFICIO','% de beneficio sobre el total','Moqueta + piezas',0,'BENEFICIO_PCT','0.0%')]
for i,(nm,op,dm,val,key,fmt) in enumerate(rows):
    for c,v in zip('ABCDEF',['',nm,op,dm,val,key]):
        cell=ws[f'{c}{r}']; cell.value=v if v!='' else None; cell.border=box; cell.font=f_norm
        cell.alignment=Alignment(horizontal='center' if c in 'AF' else 'left',vertical='center')
    ws[f'B{r}'].font=f_bold; ws[f'F{r}'].font=f_key
    e=ws[f'E{r}']; e.number_format=fmt; e.fill=fill_in; e.font=f_in
    e.alignment=Alignment(horizontal='right'); e.protection=Protection(locked=False)
    r+=1
benef_row=r-1
ws[f'A{r+0}']='Beneficio: escribe 15 para sumar un 15 % al precio total de la configuración (moqueta + todas las piezas). 0 = sin beneficio.'
ws[f'A{r+0}'].font=f_note
ws[f'A{r+1}']='Se aplica como recargo sobre el coste: Total = (moqueta + piezas) × (1 + % / 100).'
ws[f'A{r+1}'].font=f_note

# validaciones
dv=DataValidation(type='decimal',operator='greaterThanOrEqual',formula1='0',allow_blank=True,
                  showErrorMessage=True,errorTitle='Precio no válido',error='Introduce un número mayor o igual que 0.')
dv.add(f'E{first}:E{last}'); dv.add(f'E{floor_row}'); ws.add_data_validation(dv)
dv2=DataValidation(type='decimal',operator='between',formula1='0',formula2='10',allow_blank=True,
                   showErrorMessage=True,errorTitle='Porcentaje no válido',error='Introduce un porcentaje entre 0 % y 1000 % (por ejemplo 15 para un 15 %).')
dv2.add(f'E{benef_row}'); ws.add_data_validation(dv2)

# protección sin contraseña: solo se pueden editar las celdas amarillas
ws.protection.sheet=True
ws.protection.formatColumns=False; ws.protection.formatRows=False
ws.freeze_panes=f'A{HR+1}'
ws.page_setup.orientation='portrait'; ws.page_setup.fitToWidth=1; ws.sheet_properties.pageSetUpPr.fitToPage=True; ws.page_setup.fitToHeight=0
wb.save('data/precios.xlsx')
print('filas de piezas:',last-first+1,'| suelo en E%d | beneficio en E%d'%(floor_row,benef_row))
