import {select, selectAll, event} from 'd3-selection';
import './www-init.js';
import '../app/bin/backend/all.js';
import '../app/bin/frontend/app.bundle.css';
import _App from '../app/src/frontend/vue/main.js';

describe('FileStatus table for an empty project', function () {
	const holder=select('body').append('div')
	let app
	beforeAll(function (done) {
		window.testdata='fakeTools';
		holder.append('div').attr('id','fsaaa');
		app=_App('#fsaaa',{"showAllFiles":true,"showAllProjects":true});
		app.$router.push('/download');
		setTimeout(()=>{
			app.$store.commit('setCurrToolName','x1');
			done()
		},600);
	});

	it('should not be displayed', function (done) {
		setTimeout(()=>{
			expect(holder.select('#file-status-div').node()).toEqual(null);
			done();
		},500);
	});

	afterAll(function(done) {
		holder.remove();
		done();
	});
});

describe('FileStatus table for a project with pending downloads', function () {
	const holder=select('body').append('div');
	let app
	
	beforeAll(function (done) {
		window.testdata='fakeTools';
		holder.append('div').attr('id','fsbbb');
		app=_App('#fsbbb',{"showAllFiles":true,"showAllProjects":true});
		app.$router.push('/download');
		setTimeout(()=>{
			app.$store.commit('setCurrToolName','x2');
			done()
		},600);
	});

	it('should be displayed', function (done) {
		setTimeout(()=>{
			expect(holder.select('#file-status-div').size()).toEqual(1);
			done();
		},500);
	});

	it('should have 9 rows of listed files', function (done) {
		setTimeout(()=>{
			expect(holder.select('#file-status-table-body').selectAll('tr').size()).toEqual(9);
			done();
		},500);
	});

	it('should have 2 empty status cells', function (done) {
		expect(
			holder.select('#file-status-table-body')
			.selectAll('.file-status-cell-status')
			.filter(function(d){
				return !this.innerHTML || this.innerHTML=='<!---->'
			})
			.size())
		.toEqual(2);
		
		done();
	});

	it('should have 1 starting status cells', function (done) {
		expect(
			holder.select('#file-status-table-body')
			.selectAll('.file-status-cell-status')
			.filter(function(d){
				return select(this).selectAll('div').size()==1 && 
					select(this).selectAll('div').html()=='Starting...'
			})
			.size())
		.toEqual(1);
		
		done();
	});

	it('should have 4 in-progress status cells', function (done) {
		expect(
			holder.select('#file-status-table-body')
			.selectAll('.file-status-cell-status-progress-bar')
			.size())
		.toEqual(4);
		
		done();
	});

	it('should have 2 completed status cells', function (done) {
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

	afterAll(function(done) {
		holder.remove();
		done();
	});
});

describe('FileStatus table for a project with completed transfer', function () {
	const holder=select('body').append('div');
	let app
	
	beforeAll(function (done) {
		window.testdata='fakeTools';
		holder.append('div').attr('id','fsccc');
		app=_App('#fsccc',{"showAllFiles":true,"showAllProjects":true});
		app.$router.push('/download');
		setTimeout(()=>{
			app.$store.commit('setCurrToolName','x3');
			done()
		},500);
	});

	it('should not be displayed for uploads', function (done) {
		app.$router.push('/upload');
		setTimeout(()=>{
			expect(holder.select('#file-status-div').node().parentNode.style.display).toEqual('none');
			done();
		},600);
	});

	it('should have no in-progress status cells', function (done) {
		expect(
			holder.select('#file-status-table-body')
			.selectAll('.file-status-cell-status-progress-bar')
			.size())
		.toEqual(0);
		
		done();
	});

	it('should have 2 completed status cells', function (done) {
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

	afterAll(function(done) {
		holder.remove();
		done();
	});
});

