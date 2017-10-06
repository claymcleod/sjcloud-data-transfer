import {select, selectAll, event} from 'd3-selection';
import './www-init.js';
import '../app/bin/backend/all.js';
import '../app/bin/frontend/app.bundle.css';
import _App from '../app/src/frontend/vue/main.js';

describe('Download panel for an empty project', function () {
	const holder=select('body').append('div');
	holder.append('div').attr('id','downloadaaa');
	let app;
	beforeAll(function (done) {
		window.testdata='fakeTools';
		app=_App('#downloadaaa');
		app.$router.push('/download');
		setTimeout(()=>{
			app.$store.commit('setCurrToolName','x1');
			done()
		},600);
	});

	it('should not display spinkit', function (done) {
		expect(holder.selectAll('.sk-circle').size()).toEqual(0);
		done();
	});

	/*it('should show a drop-zone for uploads', function (done) {
		app.$router.push('/upload');
		setTimeout(()=>{
			expect(selectAll('.dropzone').size()).toEqual(1);
			done();
		},600);
	});*/

	afterAll(function(done) {
		holder.remove();
		done();
	});
});

describe('Download panel for a project with completed transfer', function () {
	const holder=select('body').append('div');
	holder.append('div').attr('id','downloadccc');
	let app;
	
	beforeAll(function (done) {
		window.testdata='fakeTools';
		app=_App('#downloadccc');
		app.$router.push('/download');
		setTimeout(()=>{
			app.$store.commit('setCurrToolName','x3');
			done()
		},1600);
	});

	it('should have 2 completed icons for downloads', function (done) {
		setTimeout(()=>{
			expect(
				holder.select('#file-status-table-body')
				.selectAll('.file-status-cell-status .material-icons')
				.filter(function(d){
					return select(this).html()=='check_circle'
				})
				.size())
			.toEqual(2);
			
			done();
		});
	});

	afterAll(function(done) {
		//holder.remove();
		done()
	});
});
